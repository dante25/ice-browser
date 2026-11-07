{
  let port;
  try {
    port = document.getElementById('ypp-gbh7yt');
    port.remove();
  }
  catch (e) {
    port = document.createElement('span');
    port.id = 'ypp-gbh7yt';
    document.documentElement.append(port);
  }

  let period = 2000;
  let player;
  let pprogg;

  // https://www.youtube.com/watch?v=PkZNo7MFNFg
  // https://www.youtube.com/watch?v=axMgJxZH-5s
  // https://www.youtube.com/watch?v=qLhhLeKapX4
  const chapters = ({description, seconds}) => {
    const parent = document.querySelector('.pprogg');
    if (!parent) {
      return;
    }
    // cleaning
    for (const span of parent.querySelectorAll('.pos')) {
      span.remove();
    }

    // https://support.google.com/youtube/answer/9884579?hl=en
    if (!description || description.includes('0:00') === false) {
      return;
    }

    // Extract timestamps (either 00:00:00, 0:00:00, 00:00 or 0:00)
    const lines = description.split('\n');
    const regex = /((?<h>\d{0,2}):)?(?<m>\d{1,2}):(?<s>\d{2})/;
    const chapters = [];

    for (const line of lines) {
      // Match the regex and check if the line contains a matched regex
      const m = line.match(regex);
      if (m && m.groups) {
        chapters.push(m.groups);
      }
    }

    if (chapters.length >= 3) {
      const convert = timeObject => {
        const hours = parseInt(timeObject.h) || 0;
        const minutes = parseInt(timeObject.m) || 0;
        const seconds = parseInt(timeObject.s) || 0;

        return hours * 3600 + minutes * 60 + seconds;
      };

      const percents = chapters.map(o => convert(o) / seconds * 100);

      for (const percent of percents) {
        if (percent === 0 || isNaN(percent)) {
          continue;
        }
        const span = document.createElement('span');
        span.classList.add('pos');
        span.style.left = percent + '%';
        parent.append(span);
      }
    }
  };

  const act = reason => {
    // live streams
    const response = player.getPlayerResponse();
    const b = response?.videoDetails?.isLive;
    pprogg.classList[b ? 'add' : 'remove']('live');

    // progress
    const progress = player.getCurrentTime() / player.getDuration() * 100;
    pprogg.style.setProperty('--progress', progress.toFixed(2) + '%');

    pprogg.style.setProperty('--loaded', (player.getVideoLoadedFraction() * 100).toFixed(2) + '%');
  };

  let timeout;
  const onStateChange = e => {
    clearInterval(timeout);

    // is this a live stream
    const response = player.getPlayerResponse();
    if (response?.videoDetails?.isLive) {
      pprogg.classList.add('live');
      return;
    }

    if (e === 1) {
      // for short videos, use 500ms or 1000ms
      let p = period;
      const duration = player.getDuration();
      try {
        if (duration < 2 * 60) {
          p = Math.min(300, period);
        }
        else if (duration < 5 * 60) {
          p = Math.min(500, period);
        }
        else if (duration < 10 * 60) {
          p = Math.min(1000, period);
        }
      }
      catch (e) {}

      timeout = setInterval(act, p, 'interval');
    }
    act('state change');
  };

  let op;
  let videoId;
  port.addEventListener('observe', e => {
    const prefs = e.detail;
    period = prefs.period;

    pprogg = document.querySelector('.pprogg');
    player = pprogg.closest('.html5-video-player'); // player than contains the progress bar

    if (player && pprogg) {
      // watch for progress
      if (op !== player) {
        if (op) {
          op.removeEventListener('onStateChange', onStateChange);
          op.removeEventListener('timeupdate', act);
        }

        op = player;
        player.removeEventListener('onStateChange', onStateChange);
        player.addEventListener('onStateChange', onStateChange);
        onStateChange(player.getPlayerState());

        player.removeEventListener('timeupdate', act);
        player.addEventListener('timeupdate', act);
      }
      // chapter
      if (prefs.chapters) {
        const o = player.getPlayerResponse();
        if (o) {
          const id = o?.videoDetails?.videoId;
          if (id && id !== videoId) {
            videoId = id;
            const description = o?.videoDetails?.shortDescription;
            if (description) {
              chapters({
                description,
                seconds: o.videoDetails.lengthSeconds
              });
            }
          }
        }
      }
    }
  });
}
