interface CoverageFloor {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export declare const testDefaults: {
  readonly maxWorkers: number;
  readonly coverage: {
    provider: "v8";
    reporter: ["text-summary"];
    reportsDirectory: string;
    thresholds: { [glob: string]: CoverageFloor };
  };
};
