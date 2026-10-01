import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export type PickedNotificationSound =
  | { cancelled: true }
  | { cancelled: false; kind: 'default' }
  | { cancelled: false; kind: 'silent' }
  | { cancelled: false; kind: 'system'; uri: string; title: string };

export interface AthanPluginInterface {
  createAthanChannel(options: {
    channelId: string;
    channelName: string;
    soundFilePath: string;
  }): Promise<void>;

  deleteChannel(options: { channelId: string }): Promise<void>;

  /**
   * Open Android's own notification-sound picker. `existing` marks the sound
   * in use: 'default', 'silent', or a sound's content URI. Android only.
   */
  pickNotificationSound(options: { existing: string }): Promise<PickedNotificationSound>;

  /** A high-importance notification channel that plays the sound at `soundUri`. Android only. */
  createSoundChannel(options: {
    channelId: string;
    channelName: string;
    soundUri: string;
  }): Promise<void>;

  playPreview(options: { filePath: string }): Promise<void>;

  stopPreview(): Promise<void>;

  getExternalFilesDir(): Promise<{ path: string }>;

  canScheduleExactAlarms(): Promise<{ value: boolean }>;

  openExactAlarmSettings(): Promise<void>;

  isIgnoringBatteryOptimizations(): Promise<{ value: boolean }>;

  requestIgnoreBatteryOptimizations(): Promise<void>;

  startCompass(options?: { latitude?: number; longitude?: number }): Promise<void>;

  stopCompass(): Promise<void>;

  addListener(
    eventName: 'previewComplete',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'compassHeading',
    listenerFunc: (data: {
      heading: number;
      headingFlat: number;
      headingUpright: number;
      pitch: number;
      declination: number;
      accuracy: number;
    }) => void,
  ): Promise<PluginListenerHandle>;
}

export const AthanPlugin = registerPlugin<AthanPluginInterface>('AthanPlugin');
