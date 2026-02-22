import * as service from "./admin.service.js";

export const getStats = async (req, res) => {
  const stats = await service.fetchStats();
  res.json(stats);
};

export const getUsers = async (req, res) => {
  const users = await service.fetchUsers();
  res.json(users);
};

export const getLiveRooms = async (req, res) => {
  const rooms = await service.fetchLiveRooms();
  res.json(rooms);
};
export const getAdvancedMetrics = async (req, res) => {
  const metrics = await service.fetchAdvancedMetrics();
  res.json(metrics);
};

export const toggleBan = async (req, res) => {
  await service.toggleUserBan(req.params.userId);
  res.json({ message: "User updated" });
};

export const getRooms = async (req, res) => {
  const rooms = await service.fetchRooms();
  res.json(rooms);
};

export const deleteRoom = async (req, res) => {
  await service.softDeleteRoom(req.params.roomId);
  res.json({ message: "Room deleted" });
};
