// Lala stands behind the reception counter. She turns toward the local player
// when they are in front of the desk, and otherwise looks into the room.

const NEAR = 320;

function roomHeading(lala, talk) {
  if (!lala || !Number.isFinite(lala.x) || !Number.isFinite(lala.y)) return 0;
  if (!talk || !Number.isFinite(talk.x) || !Number.isFinite(talk.y)) return 0;
  const dx = talk.x - lala.x;
  const dz = talk.y - lala.y;
  if (Math.hypot(dx, dz) < 1) return 0;
  return Math.atan2(dx, dz);
}

export function lalaHeading(lala, player, talk) {
  const room = roomHeading(lala, talk);
  if (!lala || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return room;
  const dx = player.x - lala.x;
  const dz = player.y - lala.y;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 1) || dist > NEAR) return room;
  const face = Math.atan2(dx, dz);
  const delta = Math.atan2(Math.sin(face - room), Math.cos(face - room));
  // The wall is behind the counter. Past a quarter turn she would face it.
  if (Math.abs(delta) > Math.PI / 2) return room;
  return face;
}
