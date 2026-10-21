
(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded yet. Retrying...');
    window.addEventListener('DOMContentLoaded', initArena3D);
    return;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initArena3D);
  } else {
    initArena3D();
  }
  function initArena3D() {
    const container = document.getElementById('threeArenaContainer');
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060906);
    scene.fog = new THREE.FogExp2(0x060906, 0.016);
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 520;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 150);
    camera.position.set(0, 12, 22);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(renderer.domElement);
    function createTurfTexture() {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#143810';
      ctx.fillRect(0, 0, 1024, 1024);
      for (let y = 0; y < 1024; y += 128) {
        ctx.fillStyle = (y / 128) % 2 === 0 ? 'rgba(34, 94, 26, 0.35)' : 'rgba(16, 52, 14, 0.35)';
        ctx.fillRect(0, y, 1024, 128);
      }
      const imgData = ctx.getImageData(0, 0, 1024, 1024);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 35;
        data[i] = Math.min(255, Math.max(0, data[i] + noise * 0.6));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 1.3));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.4));
      }
      ctx.putImageData(imgData, 0, 0);
      ctx.strokeStyle = 'rgba(120, 210, 40, 0.28)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const len = 4 + Math.random() * 7;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 6);
      return tex;
    }
    function createTurfBumpMap() {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 512, 512);
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = Math.floor(Math.random() * 255);
        data[i] = n;
        data[i + 1] = n;
        data[i + 2] = n;
      }
      ctx.putImageData(imgData, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(12, 12);
      return tex;
    }
    function createPitchTexture() {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 1024;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 512, 0);
      grad.addColorStop(0, '#58673a');
      grad.addColorStop(0.2, '#76854d');
      grad.addColorStop(0.5, '#849658');
      grad.addColorStop(0.8, '#76854d');
      grad.addColorStop(1, '#58673a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 1024);
      ctx.fillStyle = 'rgba(170, 185, 125, 0.18)';
      ctx.fillRect(80, 150, 352, 220);
      ctx.fillRect(80, 654, 352, 220);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(110, 880);
      ctx.lineTo(402, 880);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(60, 780);
      ctx.lineTo(452, 780);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(110, 780);
      ctx.lineTo(110, 930);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(402, 780);
      ctx.lineTo(402, 930);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(110, 144);
      ctx.lineTo(402, 144);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(60, 244);
      ctx.lineTo(452, 244);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(110, 94);
      ctx.lineTo(110, 244);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(402, 94);
      ctx.lineTo(402, 244);
      ctx.stroke();
      ctx.fillStyle = 'rgba(85, 75, 45, 0.3)';
      for (let i = 0; i < 30; i++) {
        const x = 200 + (Math.random() - 0.5) * 120;
        const y = 800 + (Math.random() - 0.5) * 45;
        ctx.beginPath();
        ctx.ellipse(x, y, 12 + Math.random() * 8, 5 + Math.random() * 4, Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
      return new THREE.CanvasTexture(c);
    }
    function createWillowTexture() {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 1024;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 512, 0);
      grad.addColorStop(0, '#be945d');
      grad.addColorStop(0.3, '#d8b178');
      grad.addColorStop(0.7, '#e4c48f');
      grad.addColorStop(1, '#c29861');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 1024);
      ctx.strokeStyle = 'rgba(110, 75, 30, 0.4)';
      ctx.lineWidth = 1.4;
      for (let x = 30; x < 490; x += 18 + Math.random() * 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        let curX = x;
        for (let y = 0; y < 1024; y += 40) {
          curX += (Math.random() - 0.5) * 4;
          ctx.lineTo(curX, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#090b09';
      ctx.fillRect(130, 360, 252, 280);
      ctx.strokeStyle = '#b8ff35';
      ctx.lineWidth = 4;
      ctx.strokeRect(132, 362, 248, 276);
      ctx.fillStyle = '#b8ff35';
      ctx.fillRect(140, 375, 232, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('POWERPLAY', 256, 440);
      ctx.fillStyle = '#b8ff35';
      ctx.font = '900 32px sans-serif';
      ctx.fillText('PRO TITAN', 256, 485);
      ctx.fillStyle = '#a6aea0';
      ctx.font = '600 18px sans-serif';
      ctx.fillText('ENGLISH WILLOW · GRADE 1', 256, 530);
      ctx.fillStyle = '#111311';
      ctx.fillRect(0, 960, 512, 64);
      ctx.strokeStyle = '#b8ff35';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 960);
      ctx.lineTo(512, 960);
      ctx.stroke();
      return new THREE.CanvasTexture(c);
    }
    function createBallTexture() {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 512;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#881216');
      grad.addColorStop(0.5, '#b91c22');
      grad.addColorStop(1, '#6f0c10');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 512);
      const imgData = ctx.getImageData(0, 0, 1024, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 22;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 0.4));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.4));
      }
      ctx.putImageData(imgData, 0, 0);
      const seamY = 256;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, seamY - 4, 1024, 8);
      ctx.strokeStyle = '#f8faf0';
      ctx.lineWidth = 3.5;
      for (let x = 0; x < 1024; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, seamY - 9);
        ctx.lineTo(x + 5, seamY + 9);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(40, 10, 10, 0.4)';
        ctx.beginPath();
        ctx.moveTo(x + 5, seamY - 9);
        ctx.lineTo(x + 6, seamY + 9);
        ctx.stroke();
        ctx.strokeStyle = '#f8faf0';
      }
      ctx.fillStyle = '#f5df88';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('POWERPLAY CLUB', 512, 170);
      ctx.font = '600 15px sans-serif';
      ctx.fillText('BHIMAVARAM · TOURNAMENTS · 156g', 512, 205);
      return new THREE.CanvasTexture(c);
    }
    function createArenaBoardTexture() {
      const c = document.createElement('canvas');
      c.width = 2048;
      c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0c100b';
      ctx.fillRect(0, 0, 2048, 256);
      ctx.fillStyle = '#b8ff35';
      ctx.fillRect(0, 0, 2048, 8);
      ctx.fillRect(0, 248, 2048, 8);
      const sections = [
        { title: 'POWERPLAY CLUB', sub: 'BHIMAVARAM · FLOODLIT TURF' },
        { title: '24/7 BOX CRICKET', sub: 'PREMIUM ARTIFICIAL TURF' },
        { title: 'POWERPLAY ARENA', sub: 'OPPOSITE SRKR ENGINEERING' },
        { title: 'CHAMPIONSHIP CUPS', sub: 'NIGHT TOURNAMENTS' },
      ];
      const segWidth = 2048 / sections.length;
      sections.forEach((sec, idx) => {
        const x = idx * segWidth;
        ctx.fillStyle = '#141c12';
        ctx.fillRect(x + 10, 16, segWidth - 20, 224);
        ctx.strokeStyle = '#293522';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 10, 16, segWidth - 20, 224);
        ctx.fillStyle = '#b8ff35';
        ctx.font = '900 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(sec.title, x + segWidth / 2, 105);
        ctx.fillStyle = '#f5f7f2';
        ctx.font = '600 20px sans-serif';
        ctx.fillText(sec.sub, x + segWidth / 2, 155);
        ctx.fillStyle = '#7a8672';
        ctx.font = '500 14px sans-serif';
        ctx.fillText('BOOK VIA WHATSAPP · 97011 67899', x + segWidth / 2, 195);
      });
      return new THREE.CanvasTexture(c);
    }
    function createNettingTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(180, 200, 170, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(128, 128);
      ctx.moveTo(128, 0);
      ctx.lineTo(0, 128);
      ctx.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(24, 12);
      return tex;
    }
    const turfMaterial = new THREE.MeshStandardMaterial({
      map: createTurfTexture(),
      bumpMap: createTurfBumpMap(),
      bumpScale: 0.08,
      roughness: 0.82,
      metalness: 0.04,
    });
    const pitchMaterial = new THREE.MeshStandardMaterial({
      map: createPitchTexture(),
      roughness: 0.68,
      metalness: 0.05,
    });
    const woodBatMaterial = new THREE.MeshStandardMaterial({
      map: createWillowTexture(),
      roughness: 0.42,
      metalness: 0.08,
    });
    const rubberGripMaterial = new THREE.MeshStandardMaterial({
      color: 0x141814,
      roughness: 0.92,
      metalness: 0.02,
    });
    const ballMaterial = new THREE.MeshStandardMaterial({
      map: createBallTexture(),
      roughness: 0.24,
      metalness: 0.06,
    });
    const woodStumpMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8cf9b,
      roughness: 0.35,
      metalness: 0.05,
    });
    const brassTipMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.3,
      metalness: 0.85,
    });
    const metalTrussMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a4238,
      roughness: 0.45,
      metalness: 0.75,
    });
    const boardMaterial = new THREE.MeshStandardMaterial({
      map: createArenaBoardTexture(),
      roughness: 0.5,
      metalness: 0.1,
    });
    const nettingMaterial = new THREE.MeshBasicMaterial({
      map: createNettingTexture(),
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const turfGeo = new THREE.PlaneGeometry(28, 42, 64, 64);
    const turfMesh = new THREE.Mesh(turfGeo, turfMaterial);
    turfMesh.rotation.x = -Math.PI / 2;
    turfMesh.receiveShadow = true;
    scene.add(turfMesh);
    const pitchGeo = new THREE.PlaneGeometry(3.6, 20.2, 16, 32);
    const pitchMesh = new THREE.Mesh(pitchGeo, pitchMaterial);
    pitchMesh.rotation.x = -Math.PI / 2;
    pitchMesh.position.y = 0.015; 
    pitchMesh.receiveShadow = true;
    scene.add(pitchMesh);
    const arenaWidth = 24;
    const arenaLength = 36;
    const fenceHeight = 5.5;
    const boardGroup = new THREE.Group();
    const boardFBGeo = new THREE.BoxGeometry(arenaWidth, 1.0, 0.15);
    const boardNorth = new THREE.Mesh(boardFBGeo, boardMaterial);
    boardNorth.position.set(0, 0.5, -arenaLength / 2);
    boardNorth.receiveShadow = true;
    boardGroup.add(boardNorth);
    const boardSouth = new THREE.Mesh(boardFBGeo, boardMaterial);
    boardSouth.position.set(0, 0.5, arenaLength / 2);
    boardSouth.receiveShadow = true;
    boardGroup.add(boardSouth);
    const boardSideGeo = new THREE.BoxGeometry(0.15, 1.0, arenaLength);
    const boardEast = new THREE.Mesh(boardSideGeo, boardMaterial);
    boardEast.position.set(arenaWidth / 2, 0.5, 0);
    boardEast.receiveShadow = true;
    boardGroup.add(boardEast);
    const boardWest = new THREE.Mesh(boardSideGeo, boardMaterial);
    boardWest.position.set(-arenaWidth / 2, 0.5, 0);
    boardWest.receiveShadow = true;
    boardGroup.add(boardWest);
    scene.add(boardGroup);
    const netSideGeo = new THREE.PlaneGeometry(arenaLength, fenceHeight);
    const netEast = new THREE.Mesh(netSideGeo, nettingMaterial);
    netEast.position.set(arenaWidth / 2, fenceHeight / 2 + 0.5, 0);
    netEast.rotation.y = -Math.PI / 2;
    scene.add(netEast);
    const netWest = new THREE.Mesh(netSideGeo, nettingMaterial);
    netWest.position.set(-arenaWidth / 2, fenceHeight / 2 + 0.5, 0);
    netWest.rotation.y = Math.PI / 2;
    scene.add(netWest);
    const netFBGeo = new THREE.PlaneGeometry(arenaWidth, fenceHeight);
    const netNorth = new THREE.Mesh(netFBGeo, nettingMaterial);
    netNorth.position.set(0, fenceHeight / 2 + 0.5, -arenaLength / 2);
    scene.add(netNorth);
    const netSouth = new THREE.Mesh(netFBGeo, nettingMaterial);
    netSouth.position.set(0, fenceHeight / 2 + 0.5, arenaLength / 2);
    netSouth.rotation.y = Math.PI;
    scene.add(netSouth);
    const netRoofGeo = new THREE.PlaneGeometry(arenaWidth, arenaLength);
    const netRoof = new THREE.Mesh(netRoofGeo, nettingMaterial);
    netRoof.position.set(0, fenceHeight + 0.5, 0);
    netRoof.rotation.x = Math.PI / 2;
    scene.add(netRoof);
    function createStumpsSet(zPos, isBattingEnd) {
      const group = new THREE.Group();
      const stumpGeo = new THREE.CylinderGeometry(0.038, 0.04, 0.76, 16);
      stumpGeo.translate(0, 0.38, 0);
      const tipGeo = new THREE.CylinderGeometry(0.041, 0.041, 0.06, 16);
      tipGeo.translate(0, 0.73, 0);
      const stumpSpacing = 0.115; 
      for (let i = -1; i <= 1; i++) {
        const stump = new THREE.Mesh(stumpGeo, woodStumpMaterial);
        stump.position.x = i * stumpSpacing;
        stump.castShadow = true;
        stump.receiveShadow = true;
        const tip = new THREE.Mesh(tipGeo, brassTipMaterial);
        tip.position.x = i * stumpSpacing;
        stump.add(tip);
        group.add(stump);
      }
      const bailGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.125, 12);
      bailGeo.rotateZ(Math.PI / 2);
      const bailLeft = new THREE.Mesh(bailGeo, woodStumpMaterial);
      bailLeft.position.set(-stumpSpacing / 2, 0.77, 0);
      bailLeft.castShadow = true;
      group.add(bailLeft);
      const bailRight = new THREE.Mesh(bailGeo, woodStumpMaterial);
      bailRight.position.set(stumpSpacing / 2, 0.77, 0);
      bailRight.castShadow = true;
      group.add(bailRight);
      group.position.set(0, 0, zPos);
      if (isBattingEnd) {
        group.rotation.y = Math.PI;
      }
      return group;
    }
    const battingStumps = createStumpsSet(8.5, true);
    const bowlingStumps = createStumpsSet(-8.5, false);
    scene.add(battingStumps);
    scene.add(bowlingStumps);
    function createCricketBat() {
      const bat = new THREE.Group();
      const bladeGeo = new THREE.BoxGeometry(0.24, 0.74, 0.065, 8, 8, 4);
      const pos = bladeGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (z < 0) {
          const spineFactor = Math.cos((y / 0.37) * Math.PI * 0.5);
          pos.setZ(i, z - Math.max(0, spineFactor * 0.04));
        }
      }
      bladeGeo.computeVertexNormals();
      const blade = new THREE.Mesh(bladeGeo, woodBatMaterial);
      blade.position.y = 0.37;
      blade.castShadow = true;
      blade.receiveShadow = true;
      bat.add(blade);
      const handleGeo = new THREE.CylinderGeometry(0.032, 0.034, 0.34, 16);
      const handle = new THREE.Mesh(handleGeo, rubberGripMaterial);
      handle.position.y = 0.74 + 0.17;
      handle.castShadow = true;
      bat.add(handle);
      const ringGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.03, 16);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xb8ff35 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.74 + 0.04;
      bat.add(ring);
      return bat;
    }
    const bat = createCricketBat();
    bat.position.set(0.65, 0.05, 7.8);
    bat.rotation.set(Math.PI / 2.3, 0.15, -Math.PI / 4);
    scene.add(bat);
    const ballGeo = new THREE.SphereGeometry(0.095, 64, 64);
    const ballMesh = new THREE.Mesh(ballGeo, ballMaterial);
    ballMesh.castShadow = true;
    ballMesh.receiveShadow = true;
    ballMesh.position.set(0.15, 0.095, 6.2);
    scene.add(ballMesh);
    const heroBallGroup = new THREE.Group();
    heroBallGroup.position.set(0, 0, 0);
    scene.add(heroBallGroup);
    const floodlightTowers = [];
    const lightFixtures = [];
    const volumetricCones = [];
    const towerPositions = [
      { x: -arenaWidth / 2 - 1.2, z: -arenaLength / 2 - 1.2, rotY: Math.PI / 4 },
      { x: arenaWidth / 2 + 1.2, z: -arenaLength / 2 - 1.2, rotY: -Math.PI / 4 },
      { x: -arenaWidth / 2 - 1.2, z: arenaLength / 2 + 1.2, rotY: (3 * Math.PI) / 4 },
      { x: arenaWidth / 2 + 1.2, z: arenaLength / 2 + 1.2, rotY: (-3 * Math.PI) / 4 },
    ];
    towerPositions.forEach((pos, idx) => {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(pos.x, 0, pos.z);
      const mastHeight = 11.5;
      const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, mastHeight, 8);
      mastGeo.translate(0, mastHeight / 2, 0);
      const mast = new THREE.Mesh(mastGeo, metalTrussMaterial);
      mast.castShadow = true;
      towerGroup.add(mast);
      const platformGeo = new THREE.BoxGeometry(2.4, 0.2, 0.6);
      const platform = new THREE.Mesh(platformGeo, metalTrussMaterial);
      platform.position.set(0, mastHeight, 0);
      platform.rotation.y = pos.rotY;
      towerGroup.add(platform);
      const ledBank = new THREE.Group();
      ledBank.position.set(0, mastHeight + 0.35, 0);
      ledBank.rotation.y = pos.rotY;
      ledBank.rotation.x = 0.35; 
      const ledFixtureGeo = new THREE.BoxGeometry(0.45, 0.45, 0.2);
      const ledHousingMat = new THREE.MeshStandardMaterial({ color: 0x181c16, roughness: 0.4 });
      const ledLensMat = new THREE.MeshBasicMaterial({ color: 0xf5faff });
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const fixture = new THREE.Mesh(ledFixtureGeo, ledHousingMat);
          fixture.position.set((c - 1) * 0.65, (r - 0.5) * 0.65, 0);
          const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), ledLensMat);
          lens.position.z = 0.11;
          fixture.add(lens);
          ledBank.add(fixture);
        }
      }
      towerGroup.add(ledBank);
      scene.add(towerGroup);
      floodlightTowers.push(towerGroup);
      const spotLight = new THREE.SpotLight(0xf2f8ff, 3.2);
      spotLight.position.set(pos.x, mastHeight + 0.5, pos.z);
      spotLight.target.position.set(0, 0.2, 0);
      scene.add(spotLight.target);
      spotLight.angle = Math.PI / 4.5;
      spotLight.penumbra = 0.6;
      spotLight.decay = 1.4;
      spotLight.distance = 45;
      spotLight.castShadow = true;
      spotLight.shadow.mapSize.width = 1024;
      spotLight.shadow.mapSize.height = 1024;
      spotLight.shadow.bias = -0.0004;
      scene.add(spotLight);
      lightFixtures.push(spotLight);
      const coneGeo = new THREE.CylinderGeometry(0.3, 5.5, 14, 16, 1, true);
      coneGeo.translate(0, -7, 0);
      coneGeo.rotateX(Math.PI / 2);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xd6e8ff,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const lightCone = new THREE.Mesh(coneGeo, coneMat);
      lightCone.position.set(pos.x, mastHeight + 0.3, pos.z);
      lightCone.lookAt(0, 0.2, 0);
      scene.add(lightCone);
      volumetricCones.push(lightCone);
    });
    const ambientLight = new THREE.AmbientLight(0x1a2618, 1.2);
    scene.add(ambientLight);
    const skyFillLight = new THREE.DirectionalLight(0x567b45, 0.85);
    skyFillLight.position.set(0, 20, 10);
    scene.add(skyFillLight);
    const cameraPresets = {
      broadcast: {
        pos: new THREE.Vector3(0, 11, 21),
        target: new THREE.Vector3(0, 1.5, 0),
        fov: 42,
      },
      crease: {
        pos: new THREE.Vector3(0.4, 2.2, 11.5),
        target: new THREE.Vector3(0.1, 1.2, 0),
        fov: 45,
      },
      equipment: {
        pos: new THREE.Vector3(1.8, 1.4, 7.8),
        target: new THREE.Vector3(0.3, 0.4, 7.0),
        fov: 38,
      },
      floodlight: {
        pos: new THREE.Vector3(-10, 4.5, 12),
        target: new THREE.Vector3(0, 8.5, -2),
        fov: 52,
      },
    };
    let currentPreset = 'broadcast';
    let targetCameraPos = cameraPresets.broadcast.pos.clone();
    let targetLookAt = cameraPresets.broadcast.target.clone();
    let currentLookAt = targetLookAt.clone();
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let orbitAzimuth = 0;
    let orbitPolar = 0.55;
    let orbitRadius = 24;
    let mouseParallax = { x: 0, y: 0 };
    let isAutoRotating = true;
    function applyPreset(name) {
      if (!cameraPresets[name]) return;
      currentPreset = name;
      isAutoRotating = name === 'broadcast';
      targetCameraPos.copy(cameraPresets[name].pos);
      targetLookAt.copy(cameraPresets[name].target);
      camera.fov = cameraPresets[name].fov;
      camera.updateProjectionMatrix();
      document.querySelectorAll('.arena3d-view-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === name);
      });
    }
    renderer.domElement.addEventListener('pointerdown', (e) => {
      isDragging = true;
      isAutoRotating = false;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseParallax.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseParallax.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      if (isDragging) {
        const deltaX = e.clientX - prevMouseX;
        const deltaY = e.clientY - prevMouseY;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        orbitAzimuth -= deltaX * 0.007;
        orbitPolar = Math.max(0.15, Math.min(Math.PI / 2.1, orbitPolar - deltaY * 0.007));
        if (currentPreset === 'broadcast') {
          targetCameraPos.x = targetLookAt.x + orbitRadius * Math.sin(orbitPolar) * Math.sin(orbitAzimuth);
          targetCameraPos.y = targetLookAt.y + orbitRadius * Math.cos(orbitPolar);
          targetCameraPos.z = targetLookAt.z + orbitRadius * Math.sin(orbitPolar) * Math.cos(orbitAzimuth);
        }
      }
    });
    const stopDragging = (e) => {
      if (isDragging) {
        isDragging = false;
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    };
    renderer.domElement.addEventListener('pointerup', stopDragging);
    renderer.domElement.addEventListener('pointercancel', stopDragging);
    renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        orbitRadius = Math.max(8, Math.min(38, orbitRadius + e.deltaY * 0.02));
        if (currentPreset === 'broadcast') {
          targetCameraPos.x = targetLookAt.x + orbitRadius * Math.sin(orbitPolar) * Math.sin(orbitAzimuth);
          targetCameraPos.y = targetLookAt.y + orbitRadius * Math.cos(orbitPolar);
          targetCameraPos.z = targetLookAt.z + orbitRadius * Math.sin(orbitPolar) * Math.cos(orbitAzimuth);
        }
      },
      { passive: false }
    );
    let isNightMode = true;
    function setLightingMode(night) {
      isNightMode = night;
      const duration = 0.8;
      const targetBg = night ? new THREE.Color(0x060906) : new THREE.Color(0x18241b);
      scene.background = targetBg;
      scene.fog.color = targetBg;
      ambientLight.intensity = night ? 1.2 : 2.4;
      ambientLight.color = new THREE.Color(night ? 0x1a2618 : 0x7c9472);
      skyFillLight.intensity = night ? 0.85 : 3.0;
      skyFillLight.color = new THREE.Color(night ? 0x567b45 : 0xfff7d6);
      lightFixtures.forEach((light) => {
        light.intensity = night ? 3.2 : 0.6;
      });
      volumetricCones.forEach((cone) => {
        cone.visible = night;
      });
      const modeBtn = document.getElementById('arenaLightingToggle');
      if (modeBtn) {
        modeBtn.innerHTML = night
          ? '<span class="status-dot night"></span> Night Match (Floodlights ON)'
          : '<span class="status-dot day"></span> Day Practice (Sunlight ON)';
      }
    }
    document.querySelectorAll('.arena3d-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPreset(btn.dataset.view);
      });
    });
    const lightingToggle = document.getElementById('arenaLightingToggle');
    if (lightingToggle) {
      lightingToggle.addEventListener('click', () => {
        setLightingMode(!isNightMode);
      });
    }
    let clock = new THREE.Clock();
    let requestID;
    function animate() {
      requestID = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      if (isAutoRotating && currentPreset === 'broadcast') {
        orbitAzimuth += delta * 0.08;
        targetCameraPos.x = targetLookAt.x + orbitRadius * Math.sin(orbitPolar) * Math.sin(orbitAzimuth);
        targetCameraPos.y = targetLookAt.y + orbitRadius * Math.cos(orbitPolar);
        targetCameraPos.z = targetLookAt.z + orbitRadius * Math.sin(orbitPolar) * Math.cos(orbitAzimuth);
      }
      const parallaxX = mouseParallax.x * 0.8;
      const parallaxY = mouseParallax.y * 0.5;
      camera.position.x += (targetCameraPos.x + parallaxX - camera.position.x) * 0.06;
      camera.position.y += (targetCameraPos.y + parallaxY - camera.position.y) * 0.06;
      camera.position.z += (targetCameraPos.z - camera.position.z) * 0.06;
      currentLookAt.x += (targetLookAt.x - currentLookAt.x) * 0.08;
      currentLookAt.y += (targetLookAt.y - currentLookAt.y) * 0.08;
      currentLookAt.z += (targetLookAt.z - currentLookAt.z) * 0.08;
      camera.lookAt(currentLookAt);
      if (ballMesh) {
        ballMesh.rotation.y += delta * 0.6;
        ballMesh.rotation.x += delta * 0.3;
      }
      if (isNightMode) {
        volumetricCones.forEach((cone, i) => {
          cone.material.opacity = 0.1 + Math.sin(elapsed * 1.5 + i) * 0.02;
        });
      }
      renderer.render(scene, camera);
    }
    animate();
    function handleResize() {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      if (newW === 0 || newH === 0) return;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', () => {
      cancelAnimationFrame(requestID);
      resizeObserver.disconnect();
      renderer.dispose();
    });
  }
})();
