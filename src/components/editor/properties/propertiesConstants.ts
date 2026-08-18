export const SPATIAL_RELATION_OPTIONS = [
  { value: '', label: '(None)' },
  { value: 'in', label: 'In' },
  { value: 'on', label: 'On' },
  { value: 'under', label: 'Under' },
  { value: 'behind', label: 'Behind' },
];

export const PROPERTIES_LABEL_TOOLTIPS: Record<string, string> = {
  'Group #ID':
    'Comma-separated tags used to address this object or selection from triggers, switches, scripts, and subscenes.',
  Parent:
    'Chooses the direct spatial parent of this object. The object will be treated as attached to that parent instead of the root scene.',
  Relation:
    'Defines how this object is attached to its parent in the spatial hierarchy: in, on, under, or behind.',
  'Group X':
    'Moves the whole selected group horizontally while preserving the relative layout between the selected objects.',
  'Group Y':
    'Moves the whole selected group vertically while preserving the relative layout between the selected objects.',
  'Group Scale':
    'Scales the whole selected group around its shared center while keeping the objects aligned with each other.',
  X: 'Horizontal position in scene space.',
  Y: 'Vertical position in scene space.',
  H: 'Visible height of the object rectangle.',
  W: 'Visible width of the object rectangle.',
  Scale:
    'Reference size multiplier for sprite objects and prefabs. Scene Correctional Scale changes existing scene objects as an editor operation, but objects entering the scene keep this Scale unchanged. For polygon objects this field scales the current shape around its center.',
  Layer: 'Render and interaction layer. Higher layers are treated as being in front of lower ones.',
  Parallax:
    'Camera parallax factor. Values around 1 move with the scene, while lower or higher values create foreground or background depth drift.',
  'Collider H':
    'Collision height used for walkbox and obstacle interaction. Set to 0 to make the object non-blocking.',
  'Collider W':
    'Collision width used for walkbox and obstacle interaction. Set to 0 to make the object non-blocking.',
  'Disable Depth-scaling':
    'Keeps the object at a fixed visual size instead of letting the scene depth-scaling system resize it by Y position.',
  'Fill Color':
    'Base fill color for the object when no sprite is used, or the tint/fill color used by this visual mode.',
  'Blend Mode': 'Canvas blend mode used to combine this object with the scene behind it.',
  Opacity:
    'Visual transparency. 0% keeps the object fully opaque; 100% makes it invisible and excluded from rendering.',
  Blur: 'Blur radius in pixels. 0 px is sharp; higher values make the object softer.',
  Sprite:
    'Sprite asset used to render this object. Leave empty to keep the plain filled rectangle look.',
  'Texture Mode':
    'Stretch maps one sprite frame across the Quad; Tile repeats the frame using Tile X and Tile Y.',
  'Tile X': 'Horizontal texture scale. 1 fills the Quad once; smaller values create more copies.',
  'Tile Y': 'Vertical texture scale. 1 fills the Quad once; smaller values create more copies.',
  Mode: 'Selects the behavior mode for this object or component.',
  'Depth Sort mode':
    'Chooses the same-Layer draw rule. By Y uses rendered Y, By Parallax uses P, and Manual keeps scene order within the Layer.',
  'Grid X': 'Number of vertical subdivisions in the retro grid effect.',
  'Grid Y': 'Number of horizontal subdivisions in the retro grid effect.',
  Width: 'Line width or stroke width used by the current visual effect.',
  'Grid Color': 'Color used to draw the retro grid lines.',
  ID: 'Unique identifier used by the engine, scripts, references, and file operations.',
  'ID/File':
    'Unique scene identifier and file path key. Slashes create subfolders when the scene is saved.',
  Title:
    'Text-asset title shown to the player and used by the text layer as the friendly name for this object or scene.',
  'Key Item ID': 'Inventory item ID required to unlock or activate this interaction.',
  Description:
    'Player-facing short description used by text interactions and subscene presentation.',
  'Target ID(s)':
    'One or more target group IDs or object IDs affected by this component or interaction.',
  'Target ID(s) (Optional)':
    'Optional target IDs affected by this component. Leave empty when the component should only provide auxiliary behavior.',
  'Target Trigger (Name/ID)':
    'Name or ID of the triggerbox that this helper area should activate as if it were clicked directly.',
  'Target(s) 1': 'Targets used when the switch is in state 1, usually the closed or default state.',
  'Target(s) 2': 'Targets used when the switch is in state 2, usually the open or alternate state.',
  'Sound 1': 'Sound played when the switch moves into state 1.',
  'Sound 2': 'Sound played when the switch moves into state 2.',
  State: 'Current switch state used as the starting state in the editor and at runtime.',
  'ID / Type':
    'State identifier and value type. Scripts, parser commands, and State events address this State by ID; changing Type resets the authored values to the default for that type.',
  Values:
    'Authored State values. Initial is the value loaded with the scene; Current is the live editor/runtime value used by scripts, parser context, world facts, and State events.',
  Initial:
    'The value this State starts with when the scene is loaded or reset. Changing it also resets Current to the same value in the editor.',
  Current:
    'The current live value of this State. Runtime scripts and parser actions change this value through the State event path.',
  'State Value':
    'Optional Parser Note mapping: when this State reaches the exact value entered here, the resolved Text Asset field overwrites this object Parser Note. Boolean and number values are matched as text, for example true, false, 1, or 75.',
  'TA Field':
    'Optional Parser Note mapping: object Text Asset field to read when the State value matches. For example, power_on reads the power_on field from this object text asset and writes it to this object Parser Note.',
  Transparent:
    'If enabled, closed contents remain visible to LOOK, but stay blocked for interaction until the switch opens.',
  'Clearly Openable':
    'If enabled, closed contents report that their container is closed instead of using generic hidden or unreachable wording.',
  'Shadow Quad ID': 'Quad that receives or shapes this shadow effect.',
  'Offset X': 'Horizontal offset applied by the component or effect.',
  'Offset Y': 'Vertical offset applied by the component or effect.',
  'Trigger ID(s) (Zone)':
    'Trigger IDs that enable, disable, or otherwise gate this component in specific zones.',
  Axis: 'Axis constrained by the component or comparison rule.',
  Op: 'Comparison operator used by the current component or condition.',
  'Culling Type':
    'Chooses how the object is culled or hidden when it falls outside the active visibility rule.',
  'Vert A (0-3)': 'First quad vertex index used by this link or rule.',
  'Vert B (0-3)': 'Second quad vertex index used by this link or rule.',
  Direction: 'Default facing direction for the actor.',
  'Move Speed': 'Actor movement speed in scene units per step.',
  'Perception Radius': 'Maximum distance at which this Actor observes other Actors actions.',
  'Anim Speed (ms)': 'Frame duration for sprite animation playback, in milliseconds.',
  'Cam X': 'Current camera X position in scene space.',
  'Cam Y': 'Current camera Y position in scene space.',
  Zoom: 'Current scene camera zoom.',
  'Auto-Center on Player':
    'Automatically keeps the camera centered on the player instead of relying on manual camera values.',
  'Cam Spd': 'Camera follow speed when auto-centering or camera tracking is active.',
  'Dead X': 'Horizontal deadzone before camera follow begins.',
  'Dead Y': 'Vertical deadzone before camera follow begins.',
  'Min X': 'Minimum allowed X value for this camera range.',
  'Max X': 'Maximum allowed X value for this camera range.',
  'Min Y': 'Minimum allowed Y value for this camera range.',
  'Max Y': 'Maximum allowed Y value for this camera range.',
  'Def X': 'Default camera X used when the scene loads or resets.',
  'Def Y': 'Default camera Y used when the scene loads or resets.',
  'Def Zoom': 'Default camera zoom used when the scene loads or resets.',
  'Enable Depth Scaling':
    'Turns scene depth scaling on or off so objects can grow or shrink according to their Y position.',
  'Receive 3d-parallax':
    'Lets a Quad nested inside a 3d-parallax Quad inherit dynamic per-vertex parallax from that parent surface.',
  Min: 'Minimum depth-scaling factor used at the horizon end of the scene.',
  Max: 'Maximum depth-scaling factor used at the front end of the scene.',
  'Horizon Y': 'Y coordinate treated as the horizon for depth scaling.',
  'Front Y': 'Y coordinate treated as the foreground limit for depth scaling.',
  'Max Distance':
    'The maximum distance (in pixels) beyond which the sound volume stops decreasing and remains at its minimum level. Useful for limiting the audible range of local sounds.',
  'Reverb Drown Dist':
    'The distance (based on depth/parallax) at which the dry sound is completely replaced by reverb. Higher values keep the sound "clear" further away; lower values make it "washy" and distant quickly.',
  'Reverb Min %':
    'The minimum amount of reverb present even when the sound is right next to the listener (at zero distance). 0.0 is completely dry; 1.0 is full reverb.',
  'Zoom Sensitivity':
    'Controls how much the camera zoom affects the perceived audio distance. 0 means zoom has no effect; 1.0 means audio distance scales 1:1 with optical zoom.',
  'Ref Distance':
    'The "Reference Distance" — the distance from the listener where volume begins to fall off. Below this value, the sound plays at 100% volume. Increase this for larger objects that should sound "close" over a wider area.',
  'Rolloff Factor':
    'Determines how quickly the volume decreases as the listener moves away from the source beyond the Reference Distance. Higher values cause a steeper, faster drop in volume.',
  'Panning Model':
    'The spatialization algorithm:\n- HRTF: High-quality, simulates human ear filtering (recommended).\n- Equal Power: Simple stereo panning without frequency filtering.',
  'Distance Model':
    'The formula used to calculate volume drop-off:\n- Linear: Steady, constant decrease.\n- Inverse: Natural-sounding decrease (logarithmic).\n- Exponential: Very sharp drop-off at a distance.',
  'Default Reverb IR':
    'Impulse response file used as the default reverb for all attached sounds in this scene. If empty, attached sounds will be dry by default.',
  'Correctional Scale':
    'Scene-wide scale correction applied on top of object Scale. Changing it scales all scene objects, including locked ones, and their absolute coordinates around the shared scene center, so neighboring objects remain neighboring.',
  'UI Scale': 'Editor interface scale multiplier.',
  'Game Zoom':
    'Scales the game viewport inside the application window. Fit uses the largest size that still stays fully visible.',
  'Attached Volume':
    'Global volume correction applied only to sounds attached to scene objects. 1.0 keeps authored sound volume unchanged; higher values boost attached 3D sounds, lower values reduce them.',
  Curvature: 'Strength of the CRT screen curvature effect.',
  Vignette: 'Darkening applied toward the screen edges.',
  'Scanline Count': 'Number of scanlines used by the CRT filter.',
  'Scanline Intensity': 'Visibility strength of the CRT scanlines.',
  'RGB Split': 'Amount of RGB channel separation in the CRT effect.',
  Bloom: 'Glow intensity added by the CRT effect.',
  'Phosphor / Grain': 'Amount of phosphor persistence and grain noise.',
  'Enable CRT Filter': 'Turns the CRT post-processing effect on or off.',
  'Bezel Glow': 'Adds a glow around the virtual CRT bezel.',
  'Lock Object': 'Prevents accidental editing of this object in the editor. Hotkey: Alt-L.',
  Disabled: 'Disables the object so it does not participate in the scene. Hotkey: Alt-D.',
  Grid: 'Enables the retro grid line overlay for this quad. It is also useful for alignment, because objects can snap to grid nodes while Alt is held.',
  Perspective:
    'Enables projective 3D perspective. Grid spacing and Quad textures follow the corresponding vanishing points; parallel edges stay evenly spaced.',
  Amount:
    'Controls the intensity of the perspective effect. 0 = flat grid, 1 = standard 3D perspective, higher values increase distortion.',
  Checkerboard:
    'Renders the Quad fill as a 2-color alternating checkerboard pattern across grid cells.',
  'Second Fill Color': 'Secondary color used for alternating checkerboard fill cells.',
  Collider: 'Teleports the Actor if their collider enters this area.',
  Portal:
    'Teleports the Actor if they activate the area (e.g. by clicking on it) while within reachable distance.',
};

export const normalizeTooltipLabelText = (rawText: string): string => {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.startsWith('Opacity')) return 'Opacity';
  if (text.startsWith('Blur')) return 'Blur';
  if (text.startsWith('UI Scale')) return 'UI Scale';
  if (text === 'State Value') return 'State Value';
  if (text.startsWith('State')) return 'State';
  if (text.startsWith('Mode:')) return 'Mode';
  if (text === 'Disable Depth Scaling') return 'Disable Depth-scaling';
  return text;
};
