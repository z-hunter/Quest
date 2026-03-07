import { PolygonObject } from './PolygonObject';

export class Walkbox extends PolygonObject {
  mode: 'Invert' | 'Add' | 'Subtract';

  /**
   * List of properties to be serialized to/from JSON.
   */
  static override SERIALIZABLE_PROPS: string[] = [...PolygonObject.SERIALIZABLE_PROPS, 'mode'];

  constructor(poly: { x: number; y: number }[], name: string = 'Walkbox') {
    super(poly, name, 'Walkbox');
    this.mode = 'Add';
  }

  toJSON(): any {
    return super.toJSON();
  }
}
