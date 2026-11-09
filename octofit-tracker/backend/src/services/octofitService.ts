import { Activity, Team, User, Workout } from '../models/index.js';

type RequestBody = Record<string, unknown>;

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

function requireBody(body: unknown): RequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('A JSON object is required');
  }
  return body as RequestBody;
}

function requireText(body: RequestBody, field: string) {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function requireObjectId(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw badRequest(`${field} must be a valid id`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw badRequest(`${field} must be a positive number`);
  }
  return value;
}

export async function listActivities() {
  return Activity.find().sort({ occurredAt: -1, _id: 1 }).lean();
}

export async function createActivity(input: unknown) {
  const body = requireBody(input);
  const userId = requireObjectId(body.userId, 'userId');
  const teamId = requireObjectId(body.teamId, 'teamId');
  const type = requireText(body, 'type').toLowerCase();
  if (!['run', 'cycle', 'strength', 'walk', 'swim', 'yoga', 'other'].includes(type)) {
    throw badRequest('type is not a supported activity');
  }
  const minutes = requirePositiveNumber(body.minutes, 'minutes');
  if (body.occurredAt !== undefined && typeof body.occurredAt !== 'string' && !(body.occurredAt instanceof Date)) {
    throw badRequest('occurredAt must be a valid date');
  }
  const occurredAt = body.occurredAt === undefined ? new Date() : new Date(String(body.occurredAt));

  if (Number.isNaN(occurredAt.getTime())) throw badRequest('occurredAt must be a valid date');
  const [user, team] = await Promise.all([User.exists({ _id: userId }), Team.exists({ _id: teamId })]);
  if (!user || !team) throw badRequest('userId and teamId must reference existing records');

  return Activity.create({ user: userId, team: teamId, type, minutes, points: minutes, occurredAt });
}

export async function listTeams() {
  return Team.find().sort({ name: 1, _id: 1 }).lean();
}

export async function createTeam(input: unknown) {
  const body = requireBody(input);
  const name = requireText(body, 'name');
  const mascot = requireText(body, 'mascot');
  const rawMembers = body.members ?? [];
  if (!Array.isArray(rawMembers)) throw badRequest('members must be an array of user ids');

  const memberIds = [...new Set(rawMembers.map((member) => requireObjectId(member, 'members')))];
  const users = memberIds.length ? await User.find({ _id: { $in: memberIds } }).select('_id') : [];
  if (users.length !== memberIds.length) throw badRequest('All members must reference existing users');

  const team = await Team.create({ name, mascot, members: memberIds });
  if (memberIds.length) {
    await Promise.all([
      Team.updateMany({ _id: { $ne: team._id } }, { $pull: { members: { $in: memberIds } } }),
      User.updateMany({ _id: { $in: memberIds } }, { $set: { team: team._id } }),
    ]);
  }
  return team;
}

export async function getLeaderboard() {
  const [teams, totals] = await Promise.all([
    Team.find().select('name mascot').lean(),
    Activity.aggregate<{ _id: unknown; totalPoints: number }>([
      { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    ]),
  ]);
  const pointsByTeam = new Map(totals.map(({ _id, totalPoints }) => [String(_id), totalPoints]));
  return teams
    .map((team) => ({
      teamId: String(team._id),
      teamName: team.name,
      mascot: team.mascot,
      totalPoints: pointsByTeam.get(String(team._id)) ?? 0,
    }))
    .sort((left, right) => right.totalPoints - left.totalPoints || left.teamName.localeCompare(right.teamName))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function suggestWorkouts(userEmail: string) {
  const user = await User.findOne({ email: userEmail.trim().toLowerCase() }).lean();
  if (!user) throw notFound('User not found');

  const activities = await Activity.find({ user: user._id }).select('type').lean();
  const activityFocus: Record<string, string> = {
    run: 'endurance',
    cycle: 'endurance',
    swim: 'endurance',
    strength: 'strength',
    walk: 'mobility',
    yoga: 'mobility',
  };
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const focus = activityFocus[activity.type];
    if (focus) counts.set(focus, (counts.get(focus) ?? 0) + 1);
  }
  const mostCommonActivityFocus = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  const preferredFocus = mostCommonActivityFocus ?? user.fitnessGoal;
  const workouts = await Workout.find().lean();
  return workouts
    .sort((left, right) => Number(right.focus === preferredFocus) - Number(left.focus === preferredFocus) || left.title.localeCompare(right.title))
    .map((workout) => ({
      ...workout,
      reason: workout.focus === preferredFocus
        ? `Matches your ${preferredFocus} goal and activity pattern.`
        : `Supports your ${user.fitnessGoal} fitness goal.`,
    }));
}

export { User };
