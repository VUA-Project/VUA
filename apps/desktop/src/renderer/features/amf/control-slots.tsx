/** Skin slots: places a skin may decorate. The default skin draws the room's corner marks, the stage edge and the
 * stage grid here; the control center reads and works the same with every slot empty. */
export function SkinSlot({ name, className }: { name: string; className: string }) {
  return <span className={className} data-skin-slot={name} aria-hidden="true"/>;
}
