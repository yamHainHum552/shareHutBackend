import { pool } from "../../config/db.js";
import { getLiveRoomSnapshot } from "../../socket/index.js";
/* ========================= */
/*           STATS           */
/* ========================= */
export const fetchLiveRooms = async () => {
  const liveRooms = getLiveRoomSnapshot();

  if (!liveRooms.length) return [];

  const roomIds = liveRooms.map((r) => r.roomId);

  const { rows } = await pool.query(
    `
    SELECT id, name, room_code,
           guest_owner_hash IS NOT NULL AS is_guest_room,
           expires_at
    FROM rooms
    WHERE id = ANY($1::uuid[])
  `,
    [roomIds],
  );

  return rows.map((room) => {
    const live = liveRooms.find((r) => r.roomId === room.id);
    return {
      ...room,
      participantsCount: live?.participantsCount || 0,
    };
  });
};

export const fetchUserGrowth = async () => {
  const { rows } = await pool.query(`
    SELECT DATE(created_at) as date,
           COUNT(*) as count
    FROM users
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  return rows;
};
export const fetchRoomGrowth = async () => {
  const { rows } = await pool.query(`
    SELECT DATE(created_at) as date,
           COUNT(*) as count
    FROM rooms
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND is_deleted IS NOT TRUE
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  return rows;
};
export const fetchRoomTypeDistribution = async () => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE guest_owner_hash IS NOT NULL) as guest_rooms,
      COUNT(*) FILTER (WHERE owner_id IS NOT NULL) as auth_rooms
    FROM rooms
    WHERE is_deleted IS NOT TRUE
  `);

  return rows[0];
};
export const fetchAverageRoomLifetime = async () => {
  const { rows } = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM (expires_at - created_at))) as avg_seconds
    FROM rooms
    WHERE expires_at IS NOT NULL
  `);

  return rows[0];
};
export const fetchAdvancedMetrics = async () => {
  const usersGrowth = await fetchUserGrowth();
  const roomsGrowth = await fetchRoomGrowth();
  const distribution = await fetchRoomTypeDistribution();
  const avgLifetime = await fetchAverageRoomLifetime();

  return {
    usersGrowth,
    roomsGrowth,
    distribution,
    avgLifetimeSeconds: Number(avgLifetime.avg_seconds || 0),
  };
};
export const fetchStats = async () => {
  const totalUsers = await pool.query("SELECT COUNT(*) FROM users");

  const totalRooms = await pool.query(
    "SELECT COUNT(*) FROM rooms WHERE is_deleted IS NOT TRUE",
  );

  const activeRooms = await pool.query(
    "SELECT COUNT(*) FROM rooms WHERE expires_at > NOW()",
  );

  const guestRooms = await pool.query(
    "SELECT COUNT(*) FROM rooms WHERE guest_owner_hash IS NOT NULL",
  );

  return {
    totalUsers: Number(totalUsers.rows[0].count),
    totalRooms: Number(totalRooms.rows[0].count),
    activeRooms: Number(activeRooms.rows[0].count),
    guestRooms: Number(guestRooms.rows[0].count),
  };
};

/* ========================= */
/*           USERS           */
/* ========================= */

export const fetchUsers = async () => {
  const { rows } = await pool.query(`
    SELECT id, name, email, role, is_banned, created_at
    FROM users
    ORDER BY created_at DESC
  `);

  return rows;
};

export const toggleUserBan = async (userId) => {
  await pool.query(
    `
    UPDATE users
    SET is_banned = NOT is_banned
    WHERE id = $1
  `,
    [userId],
  );
};

/* ========================= */
/*           ROOMS           */
/* ========================= */

export const fetchRooms = async () => {
  const { rows } = await pool.query(`
    SELECT r.id, r.name, r.room_code,
           r.owner_id,
           r.guest_owner_hash IS NOT NULL AS is_guest_room,
           r.expires_at,
           r.allow_joins,
           r.is_read_only
    FROM rooms r
    WHERE r.is_deleted IS NOT TRUE
    ORDER BY r.created_at DESC
  `);

  return rows;
};

export const softDeleteRoom = async (roomId) => {
  await pool.query(
    `
    UPDATE rooms
    SET is_deleted = TRUE
    WHERE id = $1
  `,
    [roomId],
  );
};
