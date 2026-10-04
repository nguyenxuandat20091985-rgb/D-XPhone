/**
 * D-XPhone Client - WebRTC Logic
 * Handles: getUserMedia, RTCPeerConnection, signaling via Socket.io
 * Designed as modular independent client that can be embedded later
 */

// ==================== CONFIG ====================
const SIGNALING_SERVER = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : window.location.origin; // Adjust if frontend & backend on different domains

// Free public STUN servers (Google). For production TURN, deploy your own coturn.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Optional: public TURN (rate-limited). Better to self-host coturn.
    // { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  ]
};

// ==================== STATE ====================
let socket = null;
let localStream = null;
let peerConnection = null;
let remoteSocketId = null;
let isInitiator = false;
let callStartTime = null;
let timerInterval = null;
let isMicOn = true;
let isCamOn = true;
let currentRoomId = null;

// ==================== DOM ====================
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

// ==================== INIT ====================
btnJoin.addEventListener('click', startCall);
btnToggleMic.addEventListener('click', toggleMic);
btnToggleCam.addEventListener('click', toggleCam);
btnHangup.addEventListener('click', hangUp);

// ==================== MAIN FLOW ====================
async function startCall() {
  const roomId = document.getElementById('roomId').value.trim();
  const userName = document.getElementById('userName').value.trim() || 'User';

  if (!roomId) {
    alert('Vui lòng nhập mã phòng!');
    return;
  }

  currentRoomId = roomId;
  btnJoin.disabled = true;
  btnJoin.textContent = 'Đang kết nối...';

  try {
    // 1. Get local media (camera + microphone)
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    localVideo.srcObject = localStream;

    // 2. Connect to Signaling Server
    socket = io(SIGNALING_SERVER, {
      transports: ['websocket', 'polling']
    });

    setupSocketListeners();

    // 3. Join room
    socket.emit('join-room', {
      roomId,
      userId: userName
    });

  } catch (err) {
    console.error('Error starting call:', err);
    alert('Không thể truy cập camera/microphone. Vui lòng cho phép quyền truy cập.');
    btnJoin.disabled = false;
    btnJoin.textContent = 'Tham gia cuộc gọi';
  }
}

function setupSocketListeners() {
  socket.on('connect', () => {
    console.log('Connected to signaling server:', socket.id);
  });

  socket.on('room-joined', async ({ roomId, clientsCount, isInitiator: initiator }) => {
    console.log(`Joined room ${roomId}, clients: ${clientsCount}, initiator: ${initiator}`);
    isInitiator = initiator;

    // Show call screen
    lobby.classList.remove('active');
    callScreen.classList.add('active');
    statusText.textContent = clientsCount === 1 ? 'Đang chờ đối phương...' : 'Đang kết nối...';

    // Create PeerConnection early
    createPeerConnection();
  });

  socket.on('user-joined', async ({ socketId, userId, clientsCount }) => {
    console.log(`User joined: ${userId} (${socketId})`);
    remoteSocketId = socketId;
    statusText.textContent = 'Đối phương đã vào, đang thiết lập...';

    // Standard pattern: the one who was already in room creates the offer
    // When user-joined is received by the existing peer
    await createAndSendOffer();
  });

  socket.on('offer', async ({ offer, from }) => {
    console.log('Received offer from', from);
    remoteSocketId = from;
    statusText.textContent = 'Nhận tín hiệu, đang trả lời...';

    if (!peerConnection) {
      createPeerConnection();
    }

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('answer', {
        roomId: currentRoomId,
        answer,
        to: from
      });
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  });

  socket.on('answer', async ({ answer, from }) => {
    console.log('Received answer from', from);
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      statusText.textContent = 'Đã kết nối';
      startTimer();
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  });

  socket.on('ice-candidate', async ({ candidate, from }) => {
    try {
      if (candidate && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  });

  socket.on('user-left', ({ socketId }) => {
    console.log('User left:', socketId);
    statusText.textContent = 'Đối phương đã rời cuộc gọi';
    stopTimer();
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject.getTracks().forEach(t => t.stop());
      remoteVideo.srcObject = null;
    }
  });

  socket.on('peer-media-toggle', ({ type, enabled }) => {
    console.log(`Peer ${type} is now ${enabled ? 'on' : 'off'}`);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
    alert(err.message || 'Lỗi kết nối');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from signaling server');
    statusText.textContent = 'Mất kết nối máy chủ';
  });
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle remote stream
  peerConnection.ontrack = (event) => {
    console.log('Received remote track');
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      statusText.textContent = 'Đã kết nối';
      startTimer();
    }
  };

  // ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        roomId: currentRoomId,
        candidate: event.candidate,
        to: remoteSocketId || undefined
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      statusText.textContent = 'Đã kết nối';
      startTimer();
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      statusText.textContent = 'Kết nối bị gián đoạn';
      stopTimer();
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection.iceConnectionState);
  };
}

async function createAndSendOffer() {
  if (!peerConnection) {
    createPeerConnection();
  }

  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', {
      roomId: currentRoomId,
      offer,
      to: remoteSocketId || undefined
    });
  } catch (err) {
    console.error('Error creating offer:', err);
  }
}

// ==================== CONTROLS ====================
function toggleMic() {
  if (!localStream) return;

  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = isMicOn;
  });

  iconMicOn.classList.toggle('hidden', !isMicOn);
  iconMicOff.classList.toggle('hidden', isMicOn);
  btnToggleMic.classList.toggle('active', !isMicOn);

  // Notify peer
  if (socket && currentRoomId) {
    socket.emit('toggle-media', {
      roomId: currentRoomId,
      type: 'audio',
      enabled: isMicOn
    });
  }
}

function toggleCam() {
  if (!localStream) return;

  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = isCamOn;
  });

  iconCamOn.classList.toggle('hidden', !isCamOn);
  iconCamOff.classList.toggle('hidden', isCamOn);
  btnToggleCam.classList.toggle('active', !isCamOn);

  if (socket && currentRoomId) {
    socket.emit('toggle-media', {
      roomId: currentRoomId,
      type: 'video',
      enabled: isCamOn
    });
  }
}

function hangUp() {
  // Stop tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(t => t.stop());
    remoteVideo.srcObject = null;
  }
  localVideo.srcObject = null;

  // Close peer connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // Leave room
  if (socket) {
    socket.emit('leave-room', { roomId: currentRoomId });
    socket.disconnect();
    socket = null;
  }

  stopTimer();

  // Back to lobby
  callScreen.classList.remove('active');
  lobby.classList.add('active');
  btnJoin.disabled = false;
  btnJoin.textContent = 'Tham gia cuộc gọi';
  statusText.textContent = 'Đang kết nối...';
  isMicOn = true;
  isCamOn = true;
  iconMicOn.classList.remove('hidden');
  iconMicOff.classList.add('hidden');
  iconCamOn.classList.remove('hidden');
  iconCamOff.classList.add('hidden');
  btnToggleMic.classList.remove('active');
  btnToggleCam.classList.remove('active');
}

// ==================== TIMER ====================
function startTimer() {
  if (timerInterval) return;
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00';
}
