import { describe, expect, it, vi } from 'vitest';
import { SoundManager, type AppSoundKind } from '../../src/lib/sound';

class FakeAudio {
  static created: FakeAudio[] = [];

  readonly src: string;

  preload = '';

  volume = 1;

  muted = false;

  currentTime = 0;

  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  pause = vi.fn();

  load = vi.fn();

  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }
}

const createManager = (options?: { channelsPerSound?: number; onPlaybackError?: (kind: AppSoundKind, error: unknown) => void }) =>
  new SoundManager({
    channelsPerSound: options?.channelsPerSound,
    audioFactory: (src) => new FakeAudio(src) as unknown as HTMLAudioElement,
    onPlaybackError: options?.onPlaybackError
  });

describe('SoundManager', () => {
  it('preloads reusable channels for each sound', () => {
    FakeAudio.created = [];
    const manager = createManager({ channelsPerSound: 2 });

    expect(manager.preload()).toBe(true);

    expect(FakeAudio.created).toHaveLength(6);
    expect(FakeAudio.created.map((audio) => audio.preload)).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', 'auto']);
  });

  it('unlocks sounds with muted playback', async () => {
    FakeAudio.created = [];
    const manager = createManager({ channelsPerSound: 1 });

    await expect(manager.unlock()).resolves.toBe(true);

    expect(manager.isUnlocked()).toBe(true);
    expect(FakeAudio.created).toHaveLength(3);
    for (const audio of FakeAudio.created) {
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(audio.pause).toHaveBeenCalledTimes(1);
      expect(audio.muted).toBe(false);
      expect(audio.currentTime).toBe(0);
    }
  });

  it('uses separate channels so rapid plays do not reuse the same audio element immediately', async () => {
    FakeAudio.created = [];
    const manager = createManager({ channelsPerSound: 2 });
    manager.preload();

    await manager.play('successIn');
    await manager.play('successIn');

    const successInAudios = FakeAudio.created.filter((audio) => audio.src.includes('success in'));
    expect(successInAudios).toHaveLength(2);
    expect(successInAudios[0].play).toHaveBeenCalledTimes(2);
    expect(successInAudios[1].play).toHaveBeenCalledTimes(1);
  });

  it('reports playback failures and retries with the fallback source', async () => {
    FakeAudio.created = [];
    const onPlaybackError = vi.fn();
    const manager = createManager({ channelsPerSound: 1, onPlaybackError });
    manager.preload();
    await manager.unlock();
    const successInAudio = FakeAudio.created.find((audio) => audio.src.includes('success in'));
    expect(successInAudio).toBeDefined();
    successInAudio!.play.mockRejectedValueOnce(new Error('blocked'));

    const result = await manager.play('successIn');

    expect(result.ok).toBe(true);
    expect(onPlaybackError).toHaveBeenCalledTimes(1);
    expect(FakeAudio.created.some((audio) => audio.src === '/sound/success.mp3')).toBe(true);
    expect(manager.getLastError()).toBeNull();
  });
});
