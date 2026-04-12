let myId = null;

socket.on('connect', () => { myId = socket.id; });

function startGame() {
    const country = document.getElementById('search').value;
    if(!country) return alert("Busque e selecione um país!");
    document.getElementById('priority-modal').style.display = 'block';
}

function confirmReady(priority) {
    const name = "Jogador " + myId.substring(0,4);
    const country = document.getElementById('search').value;
    
    // Pegar lat/lng do marcador atual
    const latlng = playerMarker.getLatLng();

    socket.emit('join_game', {
        name: name,
        country: country,
        lat: latlng.lat,
        lng: latlng.lng,
        color: document.getElementById('colorPicker').value
    });

    socket.emit('set_ready', { priority: priority });
    document.getElementById('priority-modal').style.display = 'none';
    log("AGUARDANDO OUTROS JOGADORES...", "#aaa");
}

socket.on('start_game', (players) => {
    log("--- A GUERRA COMEÇOU! ---", "#f00");
    document.getElementById('game-actions').style.display = 'block';
    updateTargetList(players);
    toggleInfo(true);
});

function sendAction(type, sub = null) {
    const target = document.getElementById('target-select').value;
    socket.emit('submit_action', {
        action: type,
        targetId: target,
        subAction: sub
    });
    log("ORDEM ENVIADA. AGUARDANDO TURNO...", "#555");
    document.getElementById('game-actions').style.opacity = "0.5";
    document.getElementById('game-actions').style.pointerEvents = "none";
}

socket.on('turn_results', (data) => {
    const me = data.players[myId];
    document.getElementById('stat-troops').innerText = Math.floor(me.troops);
    document.getElementById('stat-health').innerText = Math.max(0, me.health).toFixed(1) + "%";
    
    data.reports.forEach(msg => log(msg, "#fff"));
    log("--- NOVO TURNO ---", "#ff0");

    document.getElementById('game-actions').style.opacity = "1";
    document.getElementById('game-actions').style.pointerEvents = "all";
    updateTargetList(data.players);
});

function updateTargetList(players) {
    const sel = document.getElementById('target-select');
    sel.innerHTML = "";
    for(let id in players) {
        if(id !== myId && players[id].health > 0) {
            let opt = document.createElement('option');
            opt.value = id;
            opt.innerText = players[id].country.toUpperCase();
            sel.appendChild(opt);
        }
    }
}