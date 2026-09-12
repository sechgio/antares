import { describe, expectTypeOf, it } from 'vitest';
import type {
  ArrastreEntry,
  AutoImgBootstrapResponse,
  AutoImgFolder,
  AutoImgFolderPreviewResponse,
  AutoImgFoldersResponse,
  AutoImgStatus,
} from './types';

describe('AutoIMG response types', () => {
  it('reuse the canonical entry, folder and status shapes', () => {
    expectTypeOf<AutoImgFoldersResponse['folders']>().toEqualTypeOf<AutoImgFolder[]>();
    expectTypeOf<AutoImgFolderPreviewResponse['thumbs']>().toBeArray();
    expectTypeOf<AutoImgBootstrapResponse>().toMatchTypeOf<AutoImgStatus>();
    expectTypeOf<AutoImgBootstrapResponse['arrastre']>().toEqualTypeOf<ArrastreEntry[]>();
  });
});
