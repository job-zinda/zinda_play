let audio;

// Resume in the user gesture so successful network responses can play a tone.
export function prepareEngagementSound() {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) return;
  try {
    audio ||= new Audio();
    if (audio.state === "suspended") audio.resume().catch(error => console.warn("Interaction sound unavailable:", error));
  } catch (error) {
    console.warn("Interaction sound unavailable:", error);
  }
}

export function playEngagementSound(comment = false) {
  if (!audio || audio.state !== "running") return;
  try {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(comment ? 660 : 520, now);
    oscillator.frequency.exponentialRampToValueAtTime(comment ? 880 : 780, now + 0.08);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  } catch (error) {
    console.warn("Interaction sound unavailable:", error);
  }
}
