// D-Social SSO handoff: user already logged in (Google/email) on d-social.vercel.app
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'd-social') return;
    var room = params.get('room') || '';
    var name = params.get('name') || 'User';
    var peer = params.get('peer') || '';
    var roomEl = document.getElementById('roomId');
    var nameEl = document.getElementById('userName');
    if (roomEl && room) roomEl.value = room;
    if (nameEl && name) nameEl.value = name;
    var sub = document.querySelector('.subtitle');
    if (sub) sub.textContent = 'Đã đăng nhập bằng tài khoản D-Social (Google)';
    var hint = document.querySelector('.hint');
    if (hint) hint.textContent = peer ? ('Đang gọi ' + peer + ' — không cần đăng nhập lại') : 'Đang kết nối cuộc gọi...';
    window.__DX_SSO__ = { room: room, name: name, peer: peer, uid: params.get('uid') || '', email: params.get('email') || '' };
    if (room) {
      setTimeout(function () {
        var btn = document.getElementById('btnJoin');
        if (btn) btn.click();
      }, 700);
    }
  } catch (e) {}
})();
