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
    'Overall size multiplier. For polygon objects it scales the current shape around its center; for sprite objects it changes their model scale.',
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
  Mode: 'Selects the behavior mode for this object or component.',
  'Depth Sort mode':
    'Chooses which quad rule is used for Y sorting, or disables Y sorting so layer order stays fully manual.',
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
  Min: 'Minimum depth-scaling factor used at the horizon end of the scene.',
  Max: 'Maximum depth-scaling factor used at the front end of the scene.',
  'Horizon Y': 'Y coordinate treated as the horizon for depth scaling.',
  'Front Y': 'Y coordinate treated as the foreground limit for depth scaling.',
  'UI Scale': 'Editor interface scale multiplier.',
  'Game Zoom':
    'Scales the game viewport inside the application window. Fit uses the largest size that still stays fully visible.',
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
  'Retro Grid':
    'Enables the retro grid line overlay for this quad. It is also useful for alignment, because objects can snap to grid nodes while Alt is held.',
};

export const normalizeTooltipLabelText = (rawText: string): string => {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.startsWith('Opacity')) return 'Opacity';
  if (text.startsWith('Blur')) return 'Blur';
  if (text.startsWith('UI Scale')) return 'UI Scale';
  if (text.startsWith('State')) return 'State';
  if (text.startsWith('Mode:')) return 'Mode';
  if (text === 'Disable Depth Scaling') return 'Disable Depth-scaling';
  return text;
};
