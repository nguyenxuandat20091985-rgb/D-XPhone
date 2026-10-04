/**
 * D-XPhone Client v2.0
 * - Robust reconnection
 * - JWT auth support
 * - Full ICE (STUN + TURN placeholders)
 * - Better error recovery & ICE restart
 * - Adaptive media constraints
 */
(function () {
  'use strict';

  const SIGNALING_SERVER =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3001'
      : (window.DXPHONE_SIGNALING_URL || 'https://d-xphone-signaling.onrender.com');

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // TURN - uncomment after deploying coturn:
      // {
      //   urls: ['turn:turn.yourdomain.com:3478', 'turns:turn.yourdomain.com:5349'],
      //   username: 'dxphone',
      //   credential: 'your-strong-password'
      // }
    ],
    iceCandidatePoolSize: 10
  };

  let socket = null;
  let localStream = null;
  let peerConnection = null;
  let remoteSocketId = null;
  let isInitiator = false;
  let callStartTime = null;
  let timerInterval = null;
  let isMicOn = true;
  let isCamOn = true;
  const callParams = new URLSearchParams(window.location.search);
  const isVideoCall = callParams.get('mode') !== 'audio' && callParams.get('video') !== '0';
  let currentRoomId = null;
  let authToken = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 8;

  const lobby = document.getElementById('lobby');
  const callScreen = document.getElementById('call-screen');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const statusText = document.getElementById('statusText');
  const timerEl = document.getElementById('timer');
  const btnJoin = document.getElementById('btnJoin');
  const btnToggleMic = document.getElementById('btnToggleMic');
  const btnToggleCam = document.getElementById('btnToggleCam');
  const btnHangup = document.getElementById('btnHangup');
  const iconMicOn = document.getElementById('iconMicOn');
  const iconMicOff = document.getElementById('iconMicOff');
  const iconCamOn = document.getElementById('iconCamOn');
  const iconCamOff = document.getElementById('iconCamOff');

  btnJoin.addEventListener('click', startCall);
  btnToggleMic.addEventListener('click', toggleMic);
  btnToggleCam.addEventListener('click', toggleCam);
  btnHangup.addEventListener('click', hangUp);

  async function fetchToken(userId, roomId) {
    try {
      const res = await fetch(`${SIGNALING_SERVER}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roomId })
      });
      if (!res.ok) throw new Error('Token request failed');
      const data = await res.json();
      return data.token;
    } catch (err) {
      console.warn('Token fetch failed, continuing without auth (dev mode)', err);
      return null;
    }
  }

  async function startCall() {
    const roomId = document.getElementById('roomId').value.trim();
    const userName = document.getElementById('userName').value.trim() || 'User';
    if (!roomId) { alert('Vui lòng nhập mã phòng!'); return; }
    currentRoomId = roomId;
    btnJoin.disabled = true;
    btnJoin.textContent = 'Đang kết nối...';
    try {
      const constraints = {
        video: isVideoCall ? { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, facingMode: 'user', frameRate: { ideal: 24, max: 30 } } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      isCamOn = isVideoCall;
      if (btnToggleCam) btnToggleCam.hidden = !isVideoCall;
      localVideo.srcObject = localStream;
      const sso = window.__DX_SSO__ || {};
      authToken = await fetchToken(sso.uid || userName, roomId);
      connectSocket(userName);
    } catch (err) {
      console.error('startCall error:', err);
      alert('Không thể truy cập camera/microphone. Vui lòng cho phép quyền truy cập.');
      resetJoinButton();
    }
  }

  function connectSocket(userName) {
    if (socket) { socket.removeAllListeners(); socket.disconnect(); }
    socket = io(SIGNALING_SERVER, {
      transports: ['websocket', 'polling'],
      auth: authToken ? { token: authToken } : {},
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 15000
    });
    setupSocketListeners(userName);
  }

  function setupSocketListeners(userName) {
    socket.on('connect', () => {
      console.log('Connected:', socket.id);
      reconnectAttempts = 0;
      statusText.textContent = 'Đã kết nối máy chủ';
      socket.emit('join-room', { roomId: currentRoomId, userId: userName });
    });
    socket.on('connect_error', (err) => { statusText.textContent = 'Lỗi kết nối máy chủ...'; });
    socket.on('reconnect_attempt', (n) => { statusText.textContent = `Đang kết nối lại (${n}/${MAX_RECONNECT})...`; });
    socket.on('reconnect', () => {
      statusText.textContent = 'Đã kết nối lại';
      socket.emit('join-room', { roomId: currentRoomId, userId: userName });
    });
    socket.on('reconnect_failed', () => { statusText.textContent = 'Mất kết nối. Vui lòng thử lại.'; hangUp(); });
    socket.on('room-joined', async ({ roomId, clientsCount, isInitiator: initiator }) => {
      isInitiator = initiator;
      lobby.classList.remove('active');
      callScreen.classList.add('active');
      statusText.textContent = clientsCount === 1 ? 'Đang chờ đối phương...' : 'Đang thiết lập...';
      createPeerConnection();
    });
    socket.on('user-joined', async ({ socketId, userId }) => {
      remoteSocketId = socketId;
      statusText.textContent = 'Đối phương đã vào, đang kết nối...';
      await createAndSendOffer();
    });
    socket.on('offer', async ({ offer, from }) => {
      remoteSocketId = from;
      statusText.textContent = 'Nhận tín hiệu, đang trả lời...';
      if (!peerConnection) createPeerConnection();
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { roomId: currentRoomId, answer, to: from });
      } catch (err) { console.error(err); statusText.textContent = 'Lỗi thiết lập kết nối'; }
    });
    socket.on('answer', async ({ answer }) => {
      try {
        if (peerConnection && peerConnection.signalingState !== 'stable') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
        statusText.textContent = 'Đã kết nối';
        startTimer();
      } catch (err) { console.error(err); }
    });
    socket.on('ice-candidate', async ({ candidate }) => {
      try { if (candidate && peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (err) { console.warn(err.message); }
    });
    socket.on('user-left', () => {
      statusText.textContent = 'Đối phương đã rời cuộc gọi';
      stopTimer();
      cleanupRemote();
    });
    socket.on('error', (err) => { statusText.textContent = err.message || 'Lỗi'; });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') socket.connect();
    });
  }

  function createPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    if (localStream) localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = (event) => {
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        statusText.textContent = 'Đã kết nối';
        startTimer();
      }
    };
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { roomId: currentRoomId, candidate: event.candidate, to: remoteSocketId || undefined });
      }
    };
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') { statusText.textContent = 'Đã kết nối'; startTimer(); }
      else if (state === 'disconnected' || state === 'failed') { statusText.textContent = 'Kết nối bị gián đoạn...'; tryIceRestart(); }
    };
  }

  async function tryIceRestart() {
    if (!peerConnection || !isInitiator) return;
    try {
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { roomId: currentRoomId, offer, to: remoteSocketId || undefined });
    } catch (err) { console.warn('ICE restart failed', err); }
  }

  async function createAndSendOffer() {
    if (!peerConnection) createPeerConnection();
    try {
      const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: isVideoCall });
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { roomId: currentRoomId, offer, to: remoteSocketId || undefined });
    } catch (err) { console.error(err); }
  }

  function toggleMic() {
    if (!localStream) return;
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
    iconMicOn.classList.toggle('hidden', !isMicOn);
    iconMicOff.classList.toggle('hidden', isMicOn);
    btnToggleMic.classList.toggle('active', !isMicOn);
    if (socket && currentRoomId) socket.emit('toggle-media', { roomId: currentRoomId, type: 'audio', enabled: isMicOn });
  }

  function toggleCam() {
    if (!localStream) return;
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
    iconCamOn.classList.toggle('hidden', !isCamOn);
    iconCamOff.classList.toggle('hidden', isCamOn);
    btnToggleCam.classList.toggle('active', !isCamOn);
    if (socket && currentRoomId) socket.emit('toggle-media', { roomId: currentRoomId, type: 'video', enabled: isCamOn });
  }

  function cleanupRemote() {
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject.getTracks().forEach(t => t.stop());
      remoteVideo.srcObject = null;
    }
  }

  function hangUp() {
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    cleanupRemote();
    localVideo.srcObject = null;
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (socket) {
      socket.emit('leave-room', { roomId: currentRoomId });
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    stopTimer();
    callScreen.classList.remove('active');
    lobby.classList.add('active');
    resetJoinButton();
    statusText.textContent = 'Đang kết nối...';
    isMicOn = true; isCamOn = isVideoCall;
    if (btnToggleCam) btnToggleCam.hidden = !isVideoCall;
    iconMicOn.classList.remove('hidden'); iconMicOff.classList.add('hidden');
    iconCamOn.classList.remove('hidden'); iconCamOff.classList.add('hidden');
    btnToggleMic.classList.remove('active'); btnToggleCam.classList.remove('active');
    remoteSocketId = null; authToken = null;
  }

  function resetJoinButton() { btnJoin.disabled = false; btnJoin.textContent = 'Tham gia cuộc gọi'; }
  function startTimer() {
    if (timerInterval) return;
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      timerEl.textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerEl.textContent = '00:00';
  }
})();
