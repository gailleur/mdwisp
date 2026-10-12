// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Replaces Mermaid's ELK layout chunk (1.4 MB, EPL-2.0) at build time. The
// default dagre layout covers every diagram type; only diagrams that opt in
// with `layout: elk` reach this module, and they get a clear error instead
// of a silent fallback.

const message = "mdwisp does not bundle the ELK layout engine; remove `layout: elk` from the diagram.";

export const render = async (): Promise<never> => {
  throw new Error(message);
};

export default { render };
