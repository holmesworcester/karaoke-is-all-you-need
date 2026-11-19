// The media has four discrete channels, in one packet stream and on one seek clock.
// Front stereo is karaoke. Rear stereo is the original mix.
export function attachAudioComparison(media, button) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error('This player needs Web Audio for audio comparison.');
  const context = new Audio();
  const source = context.createMediaElementSource(media);
  const channels = context.createChannelSplitter(4);
  channels.channelInterpretation = 'discrete';
  source.connect(channels);
  const outputs = [0, 2].map((first) => {
    const stereo = context.createChannelMerger(2);
    channels.connect(stereo, first, 0);
    channels.connect(stereo, first + 1, 1);
    const gain = context.createGain();
    gain.gain.value = first === 0 ? 1 : 0;
    stereo.connect(gain).connect(context.destination);
    return gain;
  });
  function resume() {
    if (context.state === 'suspended') context.resume().catch(() => {});
  }
  media.addEventListener('play', resume);
  media.addEventListener('playing', resume);
  media.addEventListener('pointerdown', resume);
  media.addEventListener('keydown', resume);
  button.hidden = false;
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'Original audio');
  button.setAttribute('aria-checked', 'false');
  const backingLabel = button.dataset.backingLabel || 'Karaoke';
  button.textContent = 'Audio · ' + backingLabel;
  button.addEventListener('click', () => {
    resume();
    const original = button.getAttribute('aria-checked') !== 'true';
    const now = context.currentTime;
    outputs.forEach((output, index) => {
      const level = output.gain;
      level.cancelScheduledValues(now);
      level.setValueAtTime(level.value, now);
      level.linearRampToValueAtTime(Number(index === Number(original)), now + 0.016);
    });
    button.setAttribute('aria-checked', String(original));
    button.textContent = 'Audio · ' + (original ? 'Original' : backingLabel);
  });
  return context;
}
