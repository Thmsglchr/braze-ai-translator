export interface BackendScaffoldStatus {
  readonly name: "backend";
  readonly status: "scaffolded";
}

export function getBackendScaffoldStatus(): BackendScaffoldStatus {
  return {
    name: "backend",
    status: "scaffolded"
  };
}
