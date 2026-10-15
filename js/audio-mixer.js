export class AudioMixer {
  constructor(settings) { this.settings = settings; this.context = null; this.destination = null; this.micGain = null; this.systemGain = null; this.analyser = null; this.sources = []; }
  async connect(micStream, screenStream) {
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    if (micStream?.getAudioTracks().length) this.add(micStream, this.settings.micVolume, "mic");
    if (screenStream?.getAudioTracks().length) this.add(screenStream, this.settings.systemVolume, "system");
    if (this.context.state === "suspended") await this.context.resume();
    return this.sources.length ? this.destination.stream : new MediaStream();
  }
  add(stream, volume, kind) {
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.destination);
    if (kind === "mic") { gain.connect(this.analyser); this.micGain = gain; } else this.systemGain = gain;
    this.sources.push(source);
  }
  setVolume(kind, value) { const gain = kind === "mic" ? this.micGain : this.systemGain; if (gain) gain.gain.value = value; }
  level() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data.reduce((sum, value) => sum + value, 0) / data.length / 255;
  }
  close() { this.sources.forEach(source => source.disconnect()); this.context?.close(); this.sources = []; }
}
