import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Group } from "@/database/entities/Group.entity";
import { PendingInvitation } from "@/database/entities/PendingInvitation.entity";
import { Quota } from "@/database/entities/Quota.entity";
import { User } from "@/database/entities/User.entity";
import { UserGroup } from "@/database/entities/UserGroup.entity";
import { generateToken, hashPassword } from "@/lib/auth";
import { initializeDatabase } from "@/lib/db";

const RegisterSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const validationResult = RegisterSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: z.treeifyError(validationResult.error),
        },
        { status: 400 },
      );
    }

    const { name, email, password } = validationResult.data;

    const dataSource = await initializeDatabase();
    const userRepository = dataSource.getRepository(User);
    const pendingInvitationRepository =
      dataSource.getRepository(PendingInvitation);

    // Check if user already exists
    const existingUser = await userRepository.findOne({ where: { email } });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    // Check for pending invitation to use its ID as user_id
    const firstPendingInvitation = await pendingInvitationRepository.findOne({
      where: {
        email,
        status: "pending",
      } as any,
      order: {
        created_at: "ASC",
      } as any,
    });

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create new user with invitation ID if available
    const user = userRepository.create({
      user_id: firstPendingInvitation ? firstPendingInvitation.id : undefined,
      name,
      email,
      password: hashedPassword,
    });

    await userRepository.save(user);

    // Check for pending invitations and auto-accept them
    const userGroupRepository = dataSource.getRepository(UserGroup);
    const quotaRepository = dataSource.getRepository(Quota);
    const groupRepository = dataSource.getRepository(Group);

    const pendingInvitations = await pendingInvitationRepository.find({
      where: {
        email,
        status: "pending",
      } as any,
    });

    if (pendingInvitations.length > 0) {
      await Promise.all(
        pendingInvitations.map(async (invitation: any) => {
          // Get group for default tokens
          const group = await groupRepository.findOne({
            where: { group_id: invitation.group_id } as any,
          });

          if (group) {
            // Create user group membership
            const userGroup = userGroupRepository.create({
              user_id: user.user_id,
              group_id: invitation.group_id,
              role: invitation.role,
            });

            await userGroupRepository.save(userGroup);

            // Check if quota already exists (pre-created during invitation)
            const existingQuota = await quotaRepository.findOne({
              where: {
                user_id: invitation.id,
                group_id: invitation.group_id,
              } as any,
            });

            if (!existingQuota) {
              // Create quota only if it doesn't exist
              const quota = quotaRepository.create({
                user_id: user.user_id,
                group_id: invitation.group_id,
                total_cost: group.default_cost_limit,
                used_cost: 0,
              });

              await quotaRepository.save(quota);
            }
            // If quota exists with invitation.id, it will work since user.user_id === invitation.id

            // Mark invitation as accepted
            invitation.status = "accepted";
            await pendingInvitationRepository.save(invitation);
          }
        }),
      );
    }

    // Generate JWT token
    const token = generateToken(user);

    // Create response with httpOnly cookie
    const response = NextResponse.json(
      {
        message: "User registered successfully",
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
        },
      },
      { status: 201 },
    );

    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Registration failed:", error);

    return NextResponse.json(
      {
        error: "Registration failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
