import { normalizeProfile, type ScreenProfile } from '../core/profile.js';
import commodore from './Commodore 8-bit (1985).json' with { type: 'json' };
import cyberpunkWide from './Cyberpunk wide.json' with { type: 'json' };
import cyberpunk from './Cyberpunk.json' with { type: 'json' };
import dec100 from './DEC VT-100 (1978).json' with { type: 'json' };
import dec102 from './DEC VT-102 (1980).json' with { type: 'json' };
import dec220 from './DEC VT-220 (1983).json' with { type: 'json' };
import defaultPreset from './default.json' with { type: 'json' };
import ibm2260 from './IBM 2260 (1965).json' with { type: 'json' };
import ibm3278 from './IBM 3278 (1977).json' with { type: 'json' };
import ibmMda from './IBM 5151 PC -MDA- (1981).json' with { type: 'json' };
import ibmVga from './IBM PS2 -VGA- (1987).json' with { type: 'json' };
import modern from './Modern CRT (00x).json' with { type: 'json' };
import nextstation from './NeXTstation (1990).json' with { type: 'json' };
import oldTv from './Old Color TV Surface.json' with { type: 'json' };
import robotron from './Robotron A7100 (1985).json' with { type: 'json' };
import solaris from './Solaris.json' with { type: 'json' };
import trinitron from './Trinitron -sVGA- (1989).json' with { type: 'json' };
import trinitronPro from './Trinitron Pro -sVGA- (1989).json' with { type: 'json' };
import trinitronTouch from './Trinitron touch.json' with { type: 'json' };
import vapourware from './VapourWare.json' with { type: 'json' };

const raw: Record<string, unknown> = {
  'Commodore 8-bit (1985)': commodore,
  'Cyberpunk wide': cyberpunkWide,
  Cyberpunk: cyberpunk,
  'DEC VT-100 (1978)': dec100,
  'DEC VT-102 (1980)': dec102,
  'DEC VT-220 (1983)': dec220,
  default: defaultPreset,
  'IBM 2260 (1965)': ibm2260,
  'IBM 3278 (1977)': ibm3278,
  'IBM 5151 PC -MDA- (1981)': ibmMda,
  'IBM PS2 -VGA- (1987)': ibmVga,
  'Modern CRT (00x)': modern,
  'NeXTstation (1990)': nextstation,
  'Old Color TV Surface': oldTv,
  'Robotron A7100 (1985)': robotron,
  Solaris: solaris,
  'Trinitron -sVGA- (1989)': trinitron,
  'Trinitron Pro -sVGA- (1989)': trinitronPro,
  'Trinitron touch': trinitronTouch,
  VapourWare: vapourware,
};

export const BUILT_IN_PROFILES: Readonly<Record<string, ScreenProfile>> = Object.freeze(
  Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [
      name,
      normalizeProfile(value) ??
        (() => {
          throw new Error(`Invalid built-in profile: ${name}`);
        })(),
    ])
  )
);
