import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Quota } from "@/database/entities/Quota.entity";
import { Group } from "@/database/entities/Group.entity";
import { User } from "@/database/entities/User.entity";
import { UserGroup } from "@/database/entities/UserGroup.entity";
import { initializeDatabase } from "@/lib/db";

const ConsumeQuotaSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
  policy_id: z.string().min(1, "policy_id is required"), // This is group_id
  cost: z.number().positive("cost must be a positive number"),
});

// POST /api/quota/consume - Consume cost and update quota
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = ConsumeQuotaSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
          {
            error: "Validation failed",
            details: z.treeifyError(validationResult.error),
          },
          { status: 400 },
      );
    }

    const { user_id: user_id_input, policy_id, cost } = validationResult.data;
    const group_id = policy_id;

    const dataSource = await initializeDatabase();
    const quotaRepository = dataSource.getRepository(Quota);
    const userRepository = dataSource.getRepository(User);
    const groupRepository = dataSource.getRepository(Group);
    const userGroupRepository = dataSource.getRepository(UserGroup);

    // Resolve user_id: handle both email and UUID formats
    let user_id = user_id_input;
    if (user_id_input.includes("@")) {
      // Input is an email, resolve to UUID
      const user = await userRepository.findOne({
        where: { email: user_id_input } as any,
      });

      if (!user) {
        return NextResponse.json(
            { error: "User not found" },
            { status: 404 },
        );
      }

      user_id = user.user_id;
    }

    // Find quota for this user in this group
    let quota = await quotaRepository.findOne({
      where: {
        user_id,
        group_id,
      },
    });

    if (!quota) {
      // Quota doesn't exist - check if user is a member and auto-create
      const userGroup = await userGroupRepository.findOne({
        where: {
          user_id,
          group_id,
        } as any,
      });

      if (!userGroup) {
        return NextResponse.json(
            { error: "User is not a member of this group" },
            { status: 403 },
        );
      }

      // Get group to retrieve default_cost_limit
      const group = await groupRepository.findOne({
        where: { group_id } as any,
      });

      if (!group) {
        return NextResponse.json(
            { error: "Group not found" },
            { status: 404 },
        );
      }

      // Auto-create quota with group's default limit
      quota = quotaRepository.create({
        user_id,
        group_id,
        total_cost: group.default_cost_limit || 0,
        used_cost: 0,
      });

      await quotaRepository.save(quota);

      console.log(
          `Auto-created quota for user ${user_id} in group ${group_id} with limit $${group.default_cost_limit}`,
      );
    }

    // Update cost
    quota.used_cost = Number(quota.used_cost || 0) + cost;

    await quotaRepository.save(quota);

    // Calculate remaining cost
    const used_cost = Number(quota.used_cost);
    const total_cost = Number(quota.total_cost);
    const remaining_cost = Math.max(0, total_cost - used_cost);

    console.log(
        `Consumed $${cost} for user ${user_id} (input: ${user_id_input}) in group ${group_id}. Used: $${used_cost}, Remaining: $${remaining_cost}`,
    );

    return NextResponse.json({
      used_cost,
      remaining_cost,
      total_cost,
    });
  } catch (error) {
    console.error("Failed to consume quota:", error);
    return NextResponse.json(
        {
          error: "Failed to consume quota",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
    );
  }
}
