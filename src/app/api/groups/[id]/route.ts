import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Group } from "@/database/entities/Group.entity";
import { User } from "@/database/entities/User.entity";
import { UserGroup } from "@/database/entities/UserGroup.entity";
import { Quota } from "@/database/entities/Quota.entity";
import { PendingInvitation } from "@/database/entities/PendingInvitation.entity";
import { getCurrentUser } from "@/lib/auth";
import { withAuthRequired } from "@/lib/auth-middleware";
import { initializeDatabase } from "@/lib/db";

const UpdateGroupSchema = z.object({
  name: z.string().min(3).max(255).optional(),
  default_cost_limit: z.number().min(0).optional(),
});

// GET /api/groups/[id] - Get group details
export const GET = withAuthRequired<any>(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      const groupId = id;

      const dataSource = await initializeDatabase();
      const groupRepository = dataSource.getRepository(Group);
      const userRepository = dataSource.getRepository(User);
      const userGroupRepository = dataSource.getRepository(UserGroup);
      const quotaRepository = dataSource.getRepository(Quota);
      const pendingInvitationRepository =
        dataSource.getRepository(PendingInvitation);

      // MongoDB findOne
      const group = await groupRepository.findOne({
        where: { group_id: groupId } as any,
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      // Manually populate creator
      const creator = await userRepository.findOne({
        where: { user_id: group.created_by } as any,
      });

      // Get active members
      const userGroups = await userGroupRepository.find({
        where: { group_id: groupId } as any,
      });

      const activeMembers = await Promise.all(
        userGroups.map(async (userGroup: any) => {
          const user = await userRepository.findOne({
            where: { user_id: userGroup.user_id } as any,
          });

          // Get quota information
          const quota = await quotaRepository.findOne({
            where: {
              user_id: userGroup.user_id,
              group_id: groupId,
            } as any,
          });

          return {
            id: userGroup.id,
            user_id: userGroup.user_id,
            group_id: userGroup.group_id,
            role: userGroup.role,
            joined_at: userGroup.joined_at,
            status: "active",
            user: user
              ? {
                  user_id: user.user_id,
                  name: user.name,
                  email: user.email,
                }
              : null,
            quota: quota
              ? {
                  id: quota.id,
                  total_cost: Number(quota.total_cost),
                  used_cost: Number(quota.used_cost),
                }
              : {
                  id: 0,
                  total_cost: Number(group.default_cost_limit),
                  used_cost: 0,
                },
          };
        }),
      );

      // Get pending invitations
      const pendingInvitations = await pendingInvitationRepository.find({
        where: {
          group_id: groupId,
          status: "pending",
        } as any,
      });

      const pendingMembers = pendingInvitations.map((invitation: any) => ({
        id: invitation.id,
        user_id: invitation.id,
        group_id: invitation.group_id,
        role: invitation.role,
        joined_at: invitation.created_at,
        status: "pending",
        user: {
          user_id: invitation.id,
          name: null,
          email: invitation.email,
        },
        quota: {
          id: 0,
          total_cost: Number(group.default_cost_limit),
          used_cost: 0,
        },
      }));

      // Combine active members and pending invitations
      const members = [...activeMembers, ...pendingMembers];

      // Format response
      const response = {
        ...group,
        creator: creator
          ? {
              user_id: creator.user_id,
              name: creator.name,
              email: creator.email,
            }
          : null,
        members,
        memberCount: members.length,
      };

      return NextResponse.json({ group: response });
    } catch (error) {
      console.error("Failed to fetch group:", error);
      return NextResponse.json(
        {
          error: "Failed to fetch group",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);

// PUT /api/groups/[id] - Update group
export const PUT = withAuthRequired<any>(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const user = getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const groupId = id;

      const body = await request.json();
      const validationResult = UpdateGroupSchema.safeParse(body);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: z.treeifyError(validationResult.error),
          },
          { status: 400 },
        );
      }

      const dataSource = await initializeDatabase();
      const groupRepository = dataSource.getRepository(Group);

      const group = await groupRepository.findOne({
        where: { group_id: groupId },
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      // Check if user is the creator
      if (group.created_by !== user.user_id) {
        return NextResponse.json(
          { error: "Only the group creator can update this group" },
          { status: 403 },
        );
      }

      // Update group
      const { name, default_cost_limit } = validationResult.data;
      if (name !== undefined) group.name = name;
      if (default_cost_limit !== undefined)
        group.default_cost_limit = default_cost_limit;

      await groupRepository.save(group);

      return NextResponse.json({
        message: "Group updated successfully",
        group,
      });
    } catch (error) {
      console.error("Failed to update group:", error);
      return NextResponse.json(
        {
          error: "Failed to update group",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);

// DELETE /api/groups/[id] - Delete group
export const DELETE = withAuthRequired<any>(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const user = getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const groupId = id;

      const dataSource = await initializeDatabase();
      const groupRepository = dataSource.getRepository(Group);

      const group = await groupRepository.findOne({
        where: { group_id: groupId },
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      // Check if user is the creator
      if (group.created_by !== user.user_id) {
        return NextResponse.json(
          { error: "Only the group creator can delete this group" },
          { status: 403 },
        );
      }

      await groupRepository.remove(group);

      return NextResponse.json({
        message: "Group deleted successfully",
      });
    } catch (error) {
      console.error("Failed to delete group:", error);
      return NextResponse.json(
        {
          error: "Failed to delete group",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);
