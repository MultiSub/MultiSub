export interface MpdManifestDebugSummary {
  version: number;
  manifestUrlTail: string;
  capturedAt: string;
  adaptationCount: number;
  textAdaptations: MpdAdaptationDebugSummary[];
  captionServiceAdaptations: MpdAdaptationDebugSummary[];
}

export interface MpdAdaptationDebugSummary {
  index: number;
  id?: string;
  lang?: string;
  contentType?: string;
  mimeType?: string;
  codecs?: string;
  labels: string[];
  roles: MpdDescriptorSummary[];
  accessibility: MpdDescriptorSummary[];
  representationCount: number;
  representationIds: string[];
  representationMimeTypes: string[];
  representationCodecs: string[];
  baseUrlTails: string[];
  segmentTemplates: MpdSegmentTemplateSummary[];
  reasons: string[];
}

export interface MpdDescriptorSummary {
  schemeIdUri?: string;
  value?: string;
}

export interface MpdSegmentTemplateSummary {
  mediaTail?: string;
  initializationTail?: string;
  startNumber?: string;
  duration?: string;
  timescale?: string;
  presentationTimeOffset?: string;
  timelineCount: number;
  firstTimelineEntry?: string;
}

export function summarizeMpdTextAdaptations(manifestText: string, manifestUrl: string): MpdManifestDebugSummary {
  const document = new DOMParser().parseFromString(manifestText, 'application/xml');
  const adaptationSets = elementsByLocalName(document, 'AdaptationSet');
  const summaries = adaptationSets.map((adaptationSet, index) => summarizeAdaptationSet(adaptationSet, index));

  return {
    version: 1,
    manifestUrlTail: urlTail(manifestUrl),
    capturedAt: new Date().toISOString(),
    adaptationCount: adaptationSets.length,
    textAdaptations: summaries.filter((summary) => summary.reasons.includes('text')),
    captionServiceAdaptations: summaries.filter((summary) => summary.reasons.includes('caption-service')),
  };
}

function summarizeAdaptationSet(element: Element, index: number): MpdAdaptationDebugSummary {
  const representations = directChildrenByLocalName(element, 'Representation');
  const labels = directChildrenByLocalName(element, 'Label').map((label) => label.textContent?.trim() ?? '').filter(Boolean);
  const roles = directChildrenByLocalName(element, 'Role').map(descriptorSummary);
  const accessibility = directChildrenByLocalName(element, 'Accessibility').map(descriptorSummary);
  const adaptationMimeType = attr(element, 'mimeType');
  const adaptationContentType = attr(element, 'contentType');
  const adaptationCodecs = attr(element, 'codecs');
  const representationMimeTypes = uniqueStrings(representations.flatMap((representation) => attr(representation, 'mimeType') ?? []));
  const representationCodecs = uniqueStrings(representations.flatMap((representation) => attr(representation, 'codecs') ?? []));
  const baseUrlTails = uniqueStrings([
    ...directChildrenByLocalName(element, 'BaseURL').map((baseUrl) => urlTail(baseUrl.textContent?.trim() ?? '')),
    ...representations.flatMap((representation) =>
      directChildrenByLocalName(representation, 'BaseURL').map((baseUrl) => urlTail(baseUrl.textContent?.trim() ?? '')),
    ),
  ]).filter(Boolean);
  const segmentTemplates = [
    ...directChildrenByLocalName(element, 'SegmentTemplate'),
    ...representations.flatMap((representation) => directChildrenByLocalName(representation, 'SegmentTemplate')),
  ].map(segmentTemplateSummary);

  const summary: MpdAdaptationDebugSummary = {
    index,
    id: attr(element, 'id'),
    lang: attr(element, 'lang'),
    contentType: adaptationContentType,
    mimeType: adaptationMimeType,
    codecs: adaptationCodecs,
    labels,
    roles,
    accessibility,
    representationCount: representations.length,
    representationIds: representations.map((representation) => attr(representation, 'id') ?? '').filter(Boolean),
    representationMimeTypes,
    representationCodecs,
    baseUrlTails,
    segmentTemplates,
    reasons: [],
  };

  const searchable = [
    adaptationMimeType,
    adaptationContentType,
    adaptationCodecs,
    ...representationMimeTypes,
    ...representationCodecs,
    ...labels,
    ...roles.flatMap((role) => [role.schemeIdUri, role.value]),
    ...accessibility.flatMap((item) => [item.schemeIdUri, item.value]),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (/\btext\b|text\/vtt|application\/ttml|application\/mp4|stpp|wvtt|vtt/.test(searchable)) {
    summary.reasons.push('text');
  }

  if (/caption|closed|cc|sdh|subtitle|subtitles|cea-608|cea-708/.test(searchable)) {
    summary.reasons.push('caption-service');
  }

  return summary;
}

function segmentTemplateSummary(element: Element): MpdSegmentTemplateSummary {
  const timelineEntries = directChildrenByLocalName(element, 'SegmentTimeline').flatMap((timeline) =>
    directChildrenByLocalName(timeline, 'S'),
  );
  return {
    mediaTail: tailTemplate(attr(element, 'media')),
    initializationTail: tailTemplate(attr(element, 'initialization')),
    startNumber: attr(element, 'startNumber'),
    duration: attr(element, 'duration'),
    timescale: attr(element, 'timescale'),
    presentationTimeOffset: attr(element, 'presentationTimeOffset'),
    timelineCount: timelineEntries.length,
    firstTimelineEntry: timelineEntries[0] === undefined ? undefined : timelineEntrySummary(timelineEntries[0]),
  };
}

function timelineEntrySummary(element: Element): string {
  return ['t', 'd', 'r']
    .map((name) => {
      const value = attr(element, name);
      return value === undefined ? '' : `${name}=${value}`;
    })
    .filter(Boolean)
    .join(' ');
}

function descriptorSummary(element: Element): MpdDescriptorSummary {
  return {
    schemeIdUri: attr(element, 'schemeIdUri'),
    value: attr(element, 'value'),
  };
}

function elementsByLocalName(document: Document, name: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter((element) => element.localName === name);
}

function directChildrenByLocalName(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === name);
}

function attr(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value === null || value.trim() === '' ? undefined : value.trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tailTemplate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .slice(-4)
    .join('/');
}

function urlTail(value: string): string {
  try {
    return new URL(value, window.location.href).pathname.split('/').filter(Boolean).slice(-5).join('/');
  } catch {
    return value.split('/').filter(Boolean).slice(-5).join('/');
  }
}
