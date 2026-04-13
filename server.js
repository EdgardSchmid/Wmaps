const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'wmaps.html'));
});

// ESTADO GLOBAL DO SERVIDOR
let players = {};
let gameState = 'LOBBY';
let turnCount = 0;

io.on('connection', (socket) => {
    console.log('QG estabeleceu conexão com:', socket.id);

    players[socket.id] = {
        id: socket.id,
        name: "Comandante",
        country: null,
        priority: null, 
        health: 100,
        hpMax: 100,
        troops: 60,
        
        // Atributos Base
        force: 15,    
        resist: 10,   
        speed: 10,     
        
        // Níveis
        lvlEx: 1,  
        lvlMar: 1, 
        lvlAer: 1, 

        // Mecânicas de Turno/Passivas
        consecutiveEx: 0,   
        consecutiveMarDef: 0, 
        marinaResistBuff: 0, // Buff atual no turno
        nextMarinaResistBuff: 0, // Buff que será aplicado no PRÓXIMO turno (corrige o bug)
        
        ready: false,
        action: null,
        targetId: null,
        subAction: null,
        color: '#ffff00',
        lat: null,
        lng: null
    };

    socket.on('update_lobby', (data) => {
        const p = players[socket.id];
        
        if (data.country) {
            io.emit('log_msg', { 
                msg: `INTEL: [${data.country.toUpperCase()}] MOBILIZANDO FORÇAS!`, 
                color: data.color 
            });
        }

        p.country = data.country;
        p.lat = data.lat;
        p.lng = data.lng;
        p.color = data.color;
        io.emit('sync_players', players);
    });

    socket.on('set_ready', (data) => {
        const p = players[socket.id];
        if (!p.country) return;

        p.name = data.name;
        p.priority = data.priority;
        p.ready = true;

        if (p.priority === 'populacao') {
            p.troops += 60; 
        } else if (p.priority === 'suprimentos') {
            p.hpMax = 140;
            p.health = 140;
            p.resist += 10;
        } else if (p.priority === 'industria') {
            p.speed += 5;
            p.force += 2;
        }

        const list = Object.values(players).filter(pl => pl.country);
        if (list.length >= 2 && list.every(pl => pl.ready)) {
            gameState = 'INGAME';
            turnCount = 1;
            io.emit('start_game', players);
        } else {
            io.emit('sync_players', players);
        }
    });

    socket.on('submit_action', (data) => {
        if (players[socket.id].health <= 0) return;
        players[socket.id].action = data.action;
        players[socket.id].targetId = data.targetId;
        players[socket.id].subAction = data.subAction;

        const ativos = Object.values(players).filter(pl => pl.ready && pl.health > 0);
        if (ativos.every(pl => pl.action !== null)) {
            processTurn();
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('sync_players', players);
    });
});

function processTurn() {
    let reports = [];
    const ids = Object.keys(players).filter(id => players[id].ready && players[id].health > 0);

    // 1. REGENERAÇÃO E RESET DE COMBOS
    ids.forEach(id => {
        const p = players[id];
        p.troops += 10;

        if (!(p.action === 'ataque' && p.subAction === 'ex')) {
        p.consecutiveEx = Math.max(0, p.consecutiveEx - 3);
    }

        p.marinaResistBuff = p.nextMarinaResistBuff;
        p.nextMarinaResistBuff = 0;

        // Passiva Marinha: Cura
        if (p.action === 'defesa' && p.subAction === 'mar') {
            p.consecutiveMarDef++;
            if (p.consecutiveMarDef >= 3) {
                p.health = Math.min(p.hpMax + 20, p.health + 20);
                p.consecutiveMarDef = 0;
                reports.push({ msg: `[${p.country}] Ciclo Naval Completo: +15 HP Recuperado.`, color: "#00ff00" });
            }
        } else {
            p.consecutiveMarDef = 0;
        }
        
        if (p.priority === 'industria') {
        // 2. Bônus fixo (Ajustado para ignorar o turno 0 e focar no 3, 6, 9...)
        if (turnCount > 0 && turnCount % 4 === 0) {
            p.force += 2; 
            p.resist += 2; 
            p.speed += 5;
            reports.push({ msg: `[${p.country}] Plano Quadrienal industrial concluído: +Atributos!`, color: p.color });
        }
    }
});

    // 2. FASE DE PREPARAÇÃO (UPGRADES E RECRUTAMENTO)
    ids.forEach(id => {
        const p = players[id];
        if (p.action === 'preparacao') {
            const target = players[p.targetId];
            
            // RPS: Preparar contra Defesa (Buffs agora são +2 e +5)
            if (target && target.action === 'defesa') {
                if (Math.random() < 0.30) {
                    p.force += 2; p.resist += 2; p.speed += 5;
                    reports.push({ msg: `[${p.country}] Espionagem: Status aumentados ao observar a defesa de ${target.country}.`, color: "#f1c40f" });
                }
            }

            if (p.subAction === 'recrutar') {
                // NERF: 20 padrão, 35 se tiver traço de População
                let gain = (p.priority === 'populacao') ? 35 : 20;
                p.troops += gain;
                let cura = (p.priority === 'populacao') ? 5 : 0;
                p.health = Math.min(p.hpMax + 0, p.health + cura);
                reports.push({msg: `[${p.country}] Recrutou ${gain} tropas${cura > 0 ? ' e recuperou 5 HP' : ''}.`, color: p.color 
    })
            }
            else {
                // BUFF: Força/Resist +2, Velocidade +5
                if (p.subAction === 'ex') { p.lvlEx++; p.force += 2; }
                if (p.subAction === 'mar') { p.lvlMar++; p.resist += 2; }
                if (p.subAction === 'aer') { p.lvlAer++; p.speed += 5; }
                reports.push({ msg: `[${p.country}] Evoluiu ${p.subAction.toUpperCase()} (Nível ${p['lvl'+p.subAction.charAt(0).toUpperCase()+p.subAction.slice(1,3)]})`, color: p.color });
            }
        }
    });

    // 3. FASE DE COMBATE
    let atacantes = ids
        .filter(id => players[id].action === 'ataque')
        .sort((a, b) => {
            let pA = players[a];
            let pB = players[b];
            let scoreA = (pA.subAction === 'aer' ? 80 : 0) + pA.speed + (Math.random() * 50);
            let scoreB = (pB.subAction === 'aer' ? 80 : 0) + pB.speed + (Math.random() * 50);
            return scoreB - scoreA;
        });

    atacantes.forEach(id => {
    const p = players[id];
    const target = players[p.targetId];
    if (!target || target.health <= 0 || p.health <= 0) return;

    let custo = 0;
    let danoBase = 0;
    let bonusDano = 1.0;
    let houveCritico = false;
    let penetracaoDefesa = 1.0; 
    let tomouDano = true;

    // --- 1. LÓGICA DO ATACANTE ---
    if (p.subAction === 'ex') {
        custo = 30;
        danoBase = p.force + 3 + (p.consecutiveEx * 4);
        p.consecutiveEx++;
    } 
    else if (p.subAction === 'mar') {
        custo = 15;
        danoBase = p.force * 0.75;
        p.nextMarinaResistBuff = 5; 
    } 
    else if (p.subAction === 'aer') {
        custo = 25;
        danoBase = p.force;
        let critChance = Math.min(0.5, p.speed / 100);
        if (Math.random() < critChance) {
            bonusDano = 2.;
            houveCritico = true;
            if (target.action === 'defesa') {
            penetracaoDefesa = 0.3; // Crítico perfura 70% da defesa bufada
        } else {
            penetracaoDefesa = 1.0; // Crítico bate na defesa cheia (sem perfurar base)
        }
    }
}
    if (p.priority === 'populacao' && p.troops > 100) {
    danoBase *= 1.3;
    reports.push({ msg: `[${p.country}] Está mobilizando todas as suas tropas!`, color: p.color });}

    // Verificação imediata de tropas
    if (p.troops < custo) {
        reports.push({ msg: `[${p.country}] não teve tropas o suficiente!`, color: p.color });
        return;
    }

    // --- 2. LÓGICA DO DEFENSOR ---
    let mitigacao = target.resist + (target.marinaResistBuff || 0);

    if (target.action === 'defesa') {
        bonusDano *= 0.8;
        reports.push({ msg: `[${target.country}] defendeu!`, color: target.color });

        if (target.subAction === 'mar') { 
            mitigacao *= 1.7; 
            reports.push({ msg: `[${target.country}] defendeu com sua marinha!`, color: target.color });
        } 
        else if (target.subAction === 'ex') { 
            mitigacao *= 1.05;
            p.troops = Math.max(0, p.troops - 10);
            reports.push({ msg: `[${target.country}] defendeu com seu exército e abaixou as tropas de [${p.country}]!`, color: target.color });
        } 
        else if (target.subAction === 'aer') { 
            let chanceEsquiva = Math.min(0.6, target.speed / 100);
            reports.push({ msg: `[${target.country}] defendeu com sua frota aérea!`, color: target.color });
            if (Math.random() < chanceEsquiva) {
                tomouDano = false;
            } else {
                bonusDano *= 1.5; // Falhou no desvio, fica desprevenido
                reports.push({ msg: `[${target.country}] falhou no desvio aéreo e levou mais dano!`, color: target.color });
            }
        }
    } 
    else if (target.action === 'preparacao') {
        bonusDano *= 1.3;
        reports.push({ msg: `[${p.country}] pegou [${target.country}] desprevenido!`, color: "#ff4757" });
    }

    // --- 3. PROCESSAMENTO FINAL ---
    p.troops -= custo;

    if (target.health > 0 && target.health < (target.hpMax * 0.2)) {
    reports.push({ msg: `⚠️ ALERTA: [${target.country}] está com as defesas em colapso!`, color: "#ff4757" });
}

    if (!tomouDano) {
        reports.push({ msg: `[${target.country}] desviou do ataque de [${p.country}]!`, color: target.color });
    } else {
        // Cálculo final
        let resultadoBruto = danoBase - (mitigacao * penetracaoDefesa);
        let baseSegura = Math.max(5, resultadoBruto);
        let danoFinal = baseSegura * bonusDano;
        danoFinal = Math.max(5, Math.floor(danoFinal));

        target.health -= danoFinal;

        let msgFinal = `[${p.country}] causou ${danoFinal} de dano em [${target.country}] (${p.subAction.toUpperCase()})`;
        if (houveCritico) msgFinal = "💥 CRÍTICO! " + msgFinal;

        reports.push({ msg: msgFinal, color: p.color });
    }

    // Reset de bônus temporário
    target.marinaResistBuff = 0; 
});
    // 4. LIMPEZA DE TURNO
    ids.forEach(id => {
        const p = players[id];
        p.action = null;
        // Removi o reset imediato da marinha daqui. Agora é gerido na Fase 1.
        
        if (p.health <= 0) {
            p.health = 0;
            reports.push({ msg: `!!! [${p.country.toUpperCase()}] FOI DERROTADO !!!`, color: "#ff0000" });
        }
    });

    turnCount++;
    const vivos = Object.values(players).filter(p => p.ready && p.health > 0);

    if (vivos.length === 1 && Object.values(players).filter(p => p.ready).length > 1) {
        io.emit('turn_results', { players, reports });
        setTimeout(() => io.emit('game_over', vivos[0]), 1500);
    } else {
        io.emit('turn_results', { players, reports });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVIDOR WMAPS RODANDO NA PORTA ${PORT}`);
});
