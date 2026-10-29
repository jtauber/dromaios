import type { LayoutNode, SplitItem, WorkspaceLayout } from "./workspace/layout.js";

const group = (...panels: string[]): LayoutNode => ({ kind: "tabs", id: `coco-${panels[0]}`, panels, active: panels[0]!, collapsed: false });
const area = (weight: number, node: LayoutNode): SplitItem => ({ weight, node });
const column = (id: string, ...items: SplitItem[]): LayoutNode => ({ kind: "split", id, axis: "vertical", items });

export const cocoWorkspaceKey = "dromaios:workspace:coco:1";
export const cocoDefaultLayout: WorkspaceLayout = {
  root: { kind: "split", id: "coco-columns", axis: "horizontal", items: [
    area(.42, column("coco-screen-controls", area(.7, group("screen")), area(.3, group("execution")))),
    area(.33, column("coco-cpu-memory", area(.27, group("registers")), area(.73, group("memory")))),
    area(.25, column("coco-devices", area(.27, group("sam")), area(.45, group("pias")), area(.28, group("rom", "states")))),
  ] },
};
