// D-Social SSO handoff: user already logged in (Google/email) on d-social.vercel.app
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var room = params.get('room') || '';
    var name = params.get('name') || 'User';
    var peer = params.get('peer') || '';
    var fromSocial = params.get('from') === 'd-social';
    var auto = params.get('auto') === '1' || fromSocial;
    if (!room && !fromSocial) return;

    var roomEl = document.getElementById('roomId');
    var nameEl = document.getElementById('userName');
    if (roomEl && room) roomEl.value = room;
    if (nameEl && name) nameEl.value = name;

    if (fromSocial || auto) {
      var sub = document.querySelector('.subtitle');
      if (sub) sub.textContent = fromSocial
        ? 'Đã đăng nhập bằng tài khoản D-Social (Google)'
        : 'Đang kết nối cuộc gọi...';
      var hint = document.querySelector('.hint');
      if (hint) {
        hint.textContent = peer
          ? ('Đang gọi ' + peer + ' — không cần đăng nhập lại')
          : 'Hai thiết bị cùng Room ID sẽ kết nối với nhau.';
      }
    }

    window.__DX_SSO__ = {
      room: room,
      name: name,
      peer: peer,
      uid: params.get('uid') || '',
      email: params.get('email') || '',
      from: params.get('from') || ''
    };


    if (auto && room) {
      setTimeout(function () {
        var btn = document.getElementById('btnJoin');
        if (btn) btn.click();
        setTimeout(enterCallScreen, 800);
      }, 400);
    }
  } catch (e) {}
})();
