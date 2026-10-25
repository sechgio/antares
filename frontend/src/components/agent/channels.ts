import catalog from '../../../../shared/agent-channels.json';
import type { AgentChannel } from '../../api/agentApi';

interface ChannelInfo {
  label: string;
  description: string;
}

export const CHANNELS = catalog.channels as Record<AgentChannel, ChannelInfo>;
export const CHANNEL_ORDER = Object.keys(CHANNELS) as AgentChannel[];

export function channelLabel(channel?: string | null): string | null {
  return channel && Object.prototype.hasOwnProperty.call(CHANNELS, channel)
    ? CHANNELS[channel as AgentChannel].label
    : null;
}
