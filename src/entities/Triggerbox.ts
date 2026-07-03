import { PolygonObject } from './PolygonObject';
import { normalizeTriggerComponents, type AnyTriggerComponent } from './TriggerComponents';

export class Triggerbox extends PolygonObject {
  script: string;
  components: AnyTriggerComponent[];

  /**
   * List of properties to be serialized to/from JSON.
   */
  static override SERIALIZABLE_PROPS: string[] = [...PolygonObject.SERIALIZABLE_PROPS, 'script'];

  constructor(poly: { x: number; y: number }[], name: string = 'Triggerbox', script: string = '') {
    super(poly, name, 'Triggerbox');
    this.script = script;
    this.components = [];
  }

  toJSON(): any {
    const json = super.toJSON();
    json.components = normalizeTriggerComponents(json.components);
    return json;
  }

  override load(data: any): void {
    super.load(data);
    this.components = normalizeTriggerComponents(this.components);
  }
}
