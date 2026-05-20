import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Group } from "@/database/entities/Group.entity";
import { PendingInvitation } from "@/database/entities/PendingInvitation.entity";
import { User } from "@/database/entities/User.entity";
import { UserGroup } from "@/database/entities/UserGroup.entity";
import { getCurrentUser } from "@/lib/auth";
import { withAuthRequired } from "@/lib/auth-middleware";
import { initializeDatabase } from "@/lib/db";

const AddMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().optional(),
  role: z.enum(["admin", "member"]).default("member"),
});

// POST /api/groups/[id]/members - Add member to group
export const POST = withAuthRequired<any>(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const currentUser = getCurrentUser();
      if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const groupId = id;

      const body = await request.json();
      const validationResult = AddMemberSchema.safeParse(body);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: z.treeifyError(validationResult.error),
          },
          { status: 400 },
        );
      }

      const { email, role } = validationResult.data;

      const dataSource = await initializeDatabase();
      const groupRepository = dataSource.getRepository(Group);
      const userRepository = dataSource.getRepository(User);
      const userGroupRepository = dataSource.getRepository(UserGroup);
      const quotaRepository = dataSource.getRepository("Quota");
      const pendingInvitationRepository =
        dataSource.getRepository(PendingInvitation);

      // Check if group exists
      const group = await groupRepository.findOne({
        where: { group_id: groupId } as any,
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      // Check if current user is the creator
      if (group.created_by !== currentUser.user_id) {
        return NextResponse.json(
          { error: "Only the group creator can add members" },
          { status: 403 },
        );
      }

      // Check if user exists
      const user = await userRepository.findOne({ where: { email } as any });

      if (!user) {
        // Check if pending invitation already exists
        const existingInvitation = await pendingInvitationRepository.findOne({
          where: {
            email,
            group_id: groupId,
            status: "pending",
          } as any,
        });

        if (existingInvitation) {
          return NextResponse.json(
            { error: "Invitation already sent to this email" },
            { status: 409 },
          );
        }

        // Create pending invitation
        const invitation = pendingInvitationRepository.create({
          email,
          group_id: groupId,
          role,
          status: "pending",
        });

        await pendingInvitationRepository.save(invitation);

        // Pre-create quota for pending invitation (using invitation.id as future user_id)
        const quota = quotaRepository.create({
          user_id: invitation.id,
          group_id: groupId,
          total_cost: group.default_cost_limit,
          used_cost: 0,
        });

        await quotaRepository.save(quota);

        return NextResponse.json(
          {
            message: "Invitation created successfully",
            invitation: {
              id: invitation.id,
              email: invitation.email,
              group_id: groupId,
              role: invitation.role,
              status: "pending",
              created_at: invitation.created_at,
            },
          },
          { status: 201 },
        );
      }

      // Check if user is already a member
      const existingMember = await userGroupRepository.findOne({
        where: {
          user_id: user.user_id,
          group_id: groupId,
        } as any,
      });

      if (existingMember) {
        return NextResponse.json(
          { error: "User is already a member of this group" },
          { status: 409 },
        );
      }

      // Add user to group
      const userGroup = userGroupRepository.create({
        user_id: user.user_id,
        group_id: groupId,
        role,
      });

      await userGroupRepository.save(userGroup);

      // Create quota for the new member
      const quota = quotaRepository.create({
        user_id: user.user_id,
        group_id: groupId,
        total_cost: group.default_cost_limit,
        used_cost: 0,
      });

      await quotaRepository.save(quota);

      return NextResponse.json(
        {
          message: "Member added successfully",
          member: {
            id: userGroup.id,
            user_id: user.user_id,
            group_id: groupId,
            role: userGroup.role,
            joined_at: userGroup.joined_at,
            status: "active",
            user: {
              user_id: user.user_id,
              name: user.name,
              email: user.email,
            },
            quota: {
              id: quota.id,
              total_cost: Number(quota.total_cost),
              used_cost: 0,
            },
          },
        },
        { status: 201 },
      );
    } catch (error) {
      console.error("Failed to add member:", error);
      return NextResponse.json(
        {
          error: "Failed to add member",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);
