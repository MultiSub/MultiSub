export const NETFLIX_MESSAGE_SOURCE = 'netflix-dual-sub';

export type NetflixSubtitleSlot = 'primary' | 'secondary';
export type NetflixSubtitleKind = 'subtitles' | 'captions' | 'forced';

export interface NetflixSubtitleTrack {
  id: string;
  label: string;
  language: string;
  kind: NetflixSubtitleKind;
}

export interface NetflixSubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type NetflixPageToContentMessage =
  | {
      source: typeof NETFLIX_MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'tracks';
      mediaId: string | null;
      currentTrackId: string | null;
      tracks: NetflixSubtitleTrack[];
    }
  | {
      source: typeof NETFLIX_MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'cues';
      mediaId: string;
      slot: NetflixSubtitleSlot;
      trackId: string;
      cues: NetflixSubtitleCue[];
    }
  | {
      source: typeof NETFLIX_MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'error';
      mediaId: string | null;
      message: string;
    };

export type NetflixContentToPageMessage =
  | {
      source: typeof NETFLIX_MESSAGE_SOURCE;
      direction: 'content-to-page';
      type: 'ready';
    }
  | {
      source: typeof NETFLIX_MESSAGE_SOURCE;
      direction: 'content-to-page';
      type: 'select';
      mediaId: string | null;
      slot: NetflixSubtitleSlot;
      trackId: string | null;
    };
