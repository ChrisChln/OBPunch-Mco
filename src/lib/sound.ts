export type AppSoundKind = 'successIn' | 'successOut' | 'error';

type SoundSources = Record<AppSoundKind, readonly string[]>;

type ManagedAudio = HTMLAudioElement & {
  cloneNode?: (deep?: boolean) => Node;
};

type SoundManagerOptions = {
  sources?: SoundSources;
  channelsPerSound?: number;
  audioFactory?: (src: string) => ManagedAudio;
  onPlaybackError?: (kind: AppSoundKind, error: unknown) => void;
};

export type SoundPlaybackResult = {
  ok: boolean;
  kind: AppSoundKind;
  error?: unknown;
};

const DEFAULT_SOURCES: SoundSources = {
  successIn: ['/sound/success in.mp3', '/sound/success.mp3'],
  successOut: ['/sound/success out.mp3'],
  error: ['/sound/error.mp3']
};

const SOUND_KINDS: AppSoundKind[] = ['successIn', 'successOut', 'error'];

const getDefaultAudioFactory = () => {
  if (typeof Audio === 'undefined') return null;
  return (src: string) => new Audio(src) as ManagedAudio;
};

export class SoundManager {
  private readonly sources: SoundSources;

  private readonly channelsPerSound: number;

  private readonly audioFactory: ((src: string) => ManagedAudio) | null;

  private readonly onPlaybackError?: (kind: AppSoundKind, error: unknown) => void;

  private readonly channels: Record<AppSoundKind, ManagedAudio[]> = {
    successIn: [],
    successOut: [],
    error: []
  };

  private sourceIndex: Record<AppSoundKind, number> = {
    successIn: 0,
    successOut: 0,
    error: 0
  };

  private channelIndex: Record<AppSoundKind, number> = {
    successIn: 0,
    successOut: 0,
    error: 0
  };

  private unlocked = false;

  private lastError: SoundPlaybackResult | null = null;

  constructor(options: SoundManagerOptions = {}) {
    this.sources = options.sources ?? DEFAULT_SOURCES;
    this.channelsPerSound = Math.max(1, Math.floor(options.channelsPerSound ?? 3));
    this.audioFactory = options.audioFactory ?? getDefaultAudioFactory();
    this.onPlaybackError = options.onPlaybackError;
  }

  preload() {
    if (!this.audioFactory) return false;
    for (const kind of SOUND_KINDS) {
      while (this.channels[kind].length < this.channelsPerSound) {
        const audio = this.createAudio(kind);
        if (!audio) break;
        this.channels[kind].push(audio);
      }
    }
    return true;
  }

  async unlock() {
    if (this.unlocked) return true;
    this.preload();
    const audios = SOUND_KINDS.map((kind) => this.channels[kind][0]).filter(
      (audio): audio is ManagedAudio => Boolean(audio)
    );
    if (audios.length === 0) return false;

    const results = await Promise.all(audios.map((audio) => this.tryMutedPlay(audio)));
    this.unlocked = results.some(Boolean);
    return this.unlocked;
  }

  async play(kind: AppSoundKind): Promise<SoundPlaybackResult> {
    this.preload();
    if (!this.unlocked) {
      await this.unlock();
    }

    const first = await this.tryPlayChannel(kind);
    if (first.ok) return first;

    this.reportPlaybackError(kind, first.error);
    this.replaceCurrentChannel(kind);

    const second = await this.tryPlayChannel(kind);
    if (!second.ok) {
      this.unlocked = false;
      this.reportPlaybackError(kind, second.error);
    }
    return second;
  }

  attachUserGestureUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {
    const onGesture = () => {
      void this.unlock();
    };
    target.addEventListener('keydown', onGesture, { passive: true });
    target.addEventListener('pointerdown', onGesture, { passive: true });
    return () => {
      target.removeEventListener('keydown', onGesture);
      target.removeEventListener('pointerdown', onGesture);
    };
  }

  refresh() {
    this.preload();
    for (const kind of SOUND_KINDS) {
      for (const audio of this.channels[kind]) {
        audio.load?.();
      }
    }
  }

  reset() {
    for (const kind of SOUND_KINDS) {
      this.channels[kind] = [];
      this.sourceIndex[kind] = 0;
      this.channelIndex[kind] = 0;
    }
    this.unlocked = false;
    this.lastError = null;
  }

  getLastError() {
    return this.lastError;
  }

  isUnlocked() {
    return this.unlocked;
  }

  private createAudio(kind: AppSoundKind) {
    if (!this.audioFactory) return null;
    const sources = this.sources[kind];
    const src = sources[this.sourceIndex[kind] % sources.length] ?? sources[0];
    const audio = this.audioFactory(src);
    audio.preload = 'auto';
    audio.volume = 1;
    return audio;
  }

  private async tryMutedPlay(audio: ManagedAudio) {
    const previousMuted = audio.muted;
    audio.muted = true;
    try {
      audio.currentTime = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      return true;
    } catch {
      return false;
    } finally {
      audio.muted = previousMuted;
    }
  }

  private async tryPlayChannel(kind: AppSoundKind): Promise<SoundPlaybackResult> {
    const audio = this.nextChannel(kind);
    if (!audio) return { ok: false, kind, error: new Error('Sound audio is not available.') };

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      await audio.play();
      this.lastError = null;
      return { ok: true, kind };
    } catch (error) {
      return { ok: false, kind, error };
    }
  }

  private nextChannel(kind: AppSoundKind) {
    const channels = this.channels[kind];
    if (channels.length === 0) return null;
    const index = this.channelIndex[kind] % channels.length;
    this.channelIndex[kind] = (index + 1) % channels.length;
    return channels[index] ?? null;
  }

  private replaceCurrentChannel(kind: AppSoundKind) {
    if (this.channels[kind].length === 0) return;
    const sources = this.sources[kind];
    if (sources.length > 1) {
      this.sourceIndex[kind] = (this.sourceIndex[kind] + 1) % sources.length;
    }
    const replaceIndex = (this.channelIndex[kind] + this.channels[kind].length - 1) % this.channels[kind].length;
    const audio = this.createAudio(kind);
    if (!audio) return;
    this.channels[kind][replaceIndex] = audio;
  }

  private reportPlaybackError(kind: AppSoundKind, error: unknown) {
    this.lastError = { ok: false, kind, error };
    this.onPlaybackError?.(kind, error);
  }
}

export const appSound = new SoundManager({
  onPlaybackError: (kind, error) => {
    if (import.meta.env.DEV) {
      console.warn(`[sound] ${kind} playback failed`, error);
    }
  }
});
