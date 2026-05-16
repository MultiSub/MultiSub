export const MESSAGE_SOURCE = 'hbo-dual-sub';

export interface SubtitleSegment {
  url: string;
  duration?: number;
  presentationTime?: number;
  mediaTime?: number;
}

export interface SubtitleTrackVariant {
  segments: SubtitleSegment[];
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  segments: SubtitleSegment[];
  variants?: SubtitleTrackVariant[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type PageToContentMessage =
  | {
      source: typeof MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'tracks';
      tracks: SubtitleTrack[];
    }
  | {
      source: typeof MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'cues';
      slot?: 'primary' | 'secondary';
      trackId: string;
      cues: SubtitleCue[];
    }
  | {
      source: typeof MESSAGE_SOURCE;
      direction: 'page-to-content';
      type: 'error';
      message: string;
    };

export type ContentToPageMessage =
  | {
      source: typeof MESSAGE_SOURCE;
      direction: 'content-to-page';
      type: 'select';
      slot?: 'primary' | 'secondary';
      trackId: string | null;
    };
