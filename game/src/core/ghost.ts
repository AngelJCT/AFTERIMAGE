import { RenderTarget, Vector2, QuadMesh, NodeMaterial, RendererUtils, TempNode, NodeUpdateType } from 'three/webgpu';
import { nodeObject, Fn, uv, texture, passTexture, mix, convertToTexture } from 'three/tsl';

const _size = new Vector2();
const _quad = new QuadMesh(undefined as any);
let _state: any;

/**
 * Afterimage feedback: each frame is blended into a running memory of the last ones
 * (old · persist + new · (1 − persist)), so anything that moves leaves a fading ghost — dark
 * things as well as bright ones (three's AfterImageNode keeps only the brighter of the two).
 * The game title, as an image: what stays on the eye after something has gone.
 */
class GhostNode extends TempNode {
  textureNode: any;
  persist: any;
  private compRT = new RenderTarget(1, 1, { depthBuffer: false });
  private oldRT = new RenderTarget(1, 1, { depthBuffer: false });
  private out: any;
  private old: any;
  private material: NodeMaterial | null = null;

  constructor(textureNode: any, persist: any) {
    super('vec4');
    this.textureNode = textureNode;
    this.persist = persist;
    this.out = passTexture(this as any, this.compRT.texture);
    this.old = texture(this.oldRT.texture);
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  getTextureNode() { return this.out; }

  updateBefore(frame: any): boolean | undefined {
    const { renderer } = frame;
    _state = RendererUtils.resetRendererState(renderer, _state);
    const map = this.textureNode.value;
    this.compRT.texture.type = map.type;
    this.oldRT.texture.type = map.type;
    renderer.getDrawingBufferSize(_size);
    this.compRT.setSize(_size.x, _size.y);
    this.oldRT.setSize(_size.x, _size.y);
    this.out.value = this.compRT.texture;
    this.old.value = this.oldRT.texture;
    _quad.material = this.material!;
    renderer.setRenderTarget(this.compRT);
    _quad.render(renderer);
    const t = this.oldRT; this.oldRT = this.compRT; this.compRT = t;
    RendererUtils.restoreRendererState(renderer, _state);
    return undefined;
  }

  setup(builder: any) {
    this.old.uvNode = this.textureNode.uvNode || uv();
    const blend = Fn(() => mix(this.textureNode.sample(), this.old.sample(), this.persist));
    this.material ??= new NodeMaterial();
    this.material.name = 'Ghost';
    this.material.fragmentNode = blend();
    builder.getNodeProperties(this).textureNode = this.textureNode;
    return this.out;
  }

  dispose() {
    super.dispose();
    this.compRT.dispose(); this.oldRT.dispose();
    this.material?.dispose();
  }
}

/** Ghosting feedback of `node`; `persist` 0 (none) .. ~0.9 (long trails). */
export const ghost = (node: any, persist: any) => new GhostNode(convertToTexture(node), nodeObject(persist));
