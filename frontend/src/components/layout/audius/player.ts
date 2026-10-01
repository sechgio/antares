import { streamUrl, type AudiusTrack } from './core';
import { createStreamPlayer, type StreamPlayer, type StreamStatus } from '../streaming/player';

export type AudiusStatus = StreamStatus;

export interface AudiusPlayer extends StreamPlayer<AudiusTrack> {}

export function createAudiusPlayer(): AudiusPlayer {
  return createStreamPlayer('audius', streamUrl);
}
