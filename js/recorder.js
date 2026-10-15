export class StudioRecorder {
  constructor({ onTime, onState, onData }) { this.onTime = onTime; this.onState = onState; this.onData = onData; this.timer = null; this.startedAt = 0; this.pausedAt = 0; this.pausedTotal = 0; }
  static mime() { return ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type)) || ""; }
  start(stream, bitrate) {
    const mimeType = StudioRecorder.mime();
    if (!mimeType) throw new Error("This browser does not support a compatible recording format.");
    this.chunks = []; this.mimeType = mimeType;
    this.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate * 1e6, audioBitsPerSecond: 128000 });
    this.mimeType = this.mediaRecorder.mimeType || mimeType;
    this.mediaRecorder.ondataavailable = event => { if (event.data.size > 0) this.chunks.push(event.data); };
    this.mediaRecorder.onerror = event => this.onState("error", event.error || new Error("Recording failed."));
    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      if (!blob.size) {
        this.onState("error", new Error("The browser did not produce any recording data. Try recording for a few seconds and check the selected source."));
        return;
      }
      this.onData(blob, this.duration(), this.mimeType);
    };
    this.startedAt = performance.now(); this.pausedTotal = 0; this.timer = setInterval(() => this.onTime(this.duration()), 200);
    this.mediaRecorder.start(1000); this.onState("recording");
  }
  duration() { const end = this.pausedAt || performance.now(); return Math.max(0, end - this.startedAt - this.pausedTotal); }
  pause() { if (this.mediaRecorder?.state !== "recording") return; this.mediaRecorder.pause(); this.pausedAt = performance.now(); this.onState("paused"); }
  resume() { if (this.mediaRecorder?.state !== "paused") return; this.pausedTotal += performance.now() - this.pausedAt; this.pausedAt = 0; this.mediaRecorder.resume(); this.onState("recording"); }
  stop() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
    clearInterval(this.timer);
    this.mediaRecorder.stop();
    this.onState("processing");
  }
}
