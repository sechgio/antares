export interface ChartSeries {
  name: string;
  data: number[];
}
export interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  title: string;
  labels: string[];
  series: ChartSeries[];
}
export declare const MAX_POINTS: number;
export declare const SERIES_LIMIT: number;
export declare function niceTicks(lo: number, hi: number): number[];
export declare function parseChartSpec(source: string): ChartSpec | null;
export declare function horizontalChart(spec: ChartSpec): boolean;
export declare function pieSlices(spec: ChartSpec): { labels: string[]; data: number[] };
export declare function chartToMermaid(spec: ChartSpec): string;
