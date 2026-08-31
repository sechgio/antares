import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import Thumbnail from './Thumbnail';

const getLocalThumbnail = vi.fn();
const stageFileForIpc = vi.fn();

vi.mock('../utils/localThumb', () => ({
  getLocalThumbnail: (...args: unknown[]) => getLocalThumbnail(...args),
}));

vi.mock('../utils/stageFile', () => ({
  stageFileForIpc: (...args: unknown[]) => stageFileForIpc(...args),
}));

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting = true) {
    const entry = {
      isIntersecting,
      target: this.observed[0],
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

describe('Thumbnail', () => {
  const absPath = 'C:\\photos\\sample.jpg';

  beforeEach(() => {
    getLocalThumbnail.mockReset();
    stageFileForIpc.mockReset();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses data URL when local thumbnail succeeds', async () => {
    getLocalThumbnail.mockResolvedValue('data:image/jpeg;base64,thumb');

    const { container } = render(<Thumbnail path={absPath} fileToken="antares-read_thumb" variant="card" />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,thumb');
    });

    expect(getLocalThumbnail).toHaveBeenCalledWith('antares-read_thumb', 256);
  });

  it('shows placeholder when local thumbnail fails (no file:// under CSP)', async () => {
    getLocalThumbnail.mockResolvedValue(null);

    const { container } = render(<Thumbnail path={absPath} fileToken="antares-read_thumb" variant="card" />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });

  it('does not request a thumbnail until in view', () => {
    getLocalThumbnail.mockResolvedValue(null);
    render(<Thumbnail path={absPath} fileToken="antares-read_thumb" />);
    expect(getLocalThumbnail).not.toHaveBeenCalled();
    expect(MockIntersectionObserver.instances.length).toBe(1);
  });

  it('stages a dropped File before requesting its thumbnail', async () => {
    const file = new File(['image'], 'sample.jpg', { type: 'image/jpeg' });
    stageFileForIpc.mockResolvedValue('antares-read_staged');
    getLocalThumbnail.mockResolvedValue('data:image/jpeg;base64,thumb');

    const { container } = render(<Thumbnail path={absPath} file={file} variant="card" />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(stageFileForIpc).toHaveBeenCalledWith(file);
    expect(getLocalThumbnail).toHaveBeenCalledWith('antares-read_staged', 256);
  });

  it('does not forward a legacy display path without a token or File', async () => {
    const { container } = render(<Thumbnail path={absPath} variant="card" />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    expect(getLocalThumbnail).not.toHaveBeenCalled();
  });
});
