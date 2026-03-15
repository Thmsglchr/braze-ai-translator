export interface ExtensionScaffoldStatus {
  readonly name: "extension";
  readonly status: "scaffolded";
}

export function getExtensionScaffoldStatus(): ExtensionScaffoldStatus {
  return {
    name: "extension",
    status: "scaffolded"
  };
}
