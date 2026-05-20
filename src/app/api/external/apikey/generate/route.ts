import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GrcKey } from "@/database/entities/GrcKey.entity";
import { Group } from "@/database/entities/Group.entity";
import { PendingInvitation } from "@/database/entities/PendingInvitation.entity";
import { Quota } from "@/database/entities/Quota.entity";
import { User } from "@/database/entities/User.entity";
import { UserGroup } from "@/database/entities/UserGroup.entity";
import { type ApiKeyData, encode } from "@/lib/apikey";
import { initializeDatabase } from "@/lib/db";
import { withServiceAuth } from "@/lib/service-auth-middleware";

const GenerateKeySchema = z.object({
  email: z.string().email("Invalid email address"),
  group_id: z.string().min(1, "Valid group_id is required"),
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(500).optional(),
  role: z.enum(["admin", "member"]).default("member"),
});

/**
 * POST /api/external/apikey/generate
 * Generate GRC API key for external applications
 * Requires service API key authentication
 */
export const POST = withServiceAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const validationResult = GenerateKeySchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
          {
            error: "Validation failed",
            details: z.treeifyError(validationResult.error),
          },
          { status: 400 },
      );
    }

    const { email, group_id, name, description, role } = validationResult.data;

    const dataSource = await initializeDatabase();
    const userRepository = dataSource.getRepository(User);
    const groupRepository = dataSource.getRepository(Group);
    const userGroupRepository = dataSource.getRepository(UserGroup);
    const quotaRepository = dataSource.getRepository(Quota);
    const grcKeyRepository = dataSource.getRepository(GrcKey);
    const pendingInvitationRepository =
        dataSource.getRepository(PendingInvitation);

    let memberAdded = false;
    let invitationCreated = false;

    // Step 1: Check if user exists
    let user = await userRepository.findOne({ where: { email } });
    let userId: string;

    if (!user) {
      // User doesn't exist - create/get pending invitation and use invitation.id as user_id
      let invitation = await pendingInvitationRepository.findOne({
        where: {
          email,
          group_id,
          status: "pending",
        } as any,
      });

      if (!invitation) {
        // Create pending invitation for the user
        invitation = pendingInvitationRepository.create({
          email,
          group_id,
          role,
          status: "pending",
        });

        await pendingInvitationRepository.save(invitation);
        invitationCreated = true;

        console.log(
            `Created pending invitation for ${email} to group ${group_id} (invitation ID: ${invitation.id})`,
        );
      }

      // Use invitation ID as the user_id
      userId = invitation.id;

      console.log(
          `Using invitation ID ${invitation.id} as user_id for unregistered user ${email}`,
      );
    } else {
      userId = user.user_id;
    }

    // Step 2: Verify group exists
    const group = await groupRepository.findOne({
      where: { group_id },
    });

    if (!group) {
      return NextResponse.json(
          { error: "Group not found", group_id },
          { status: 404 },
      );
    }

    // Step 3: Check if user is member of group, add if not (only if real user)
    if (user) {
      let userGroup = await userGroupRepository.findOne({
        where: {
          user_id: userId,
          group_id,
        },
      });

      if (!userGroup) {
        userGroup = userGroupRepository.create({
          user_id: userId,
          group_id,
          role: "member",
        });

        try {
          await userGroupRepository.save(userGroup);
          memberAdded = true;
          console.log(`Auto-added user ${email} to group ${group_id}`);
        } catch (saveError) {
          console.error("Failed to save UserGroup:", saveError);
          throw new Error(
              `Failed to add user to group: ${saveError instanceof Error ? saveError.message : "Unknown error"}`,
          );
        }
      }
    }

    // Step 4: Check/Create quota for user in group (for both existing and pending users)
    let quota = await quotaRepository.findOne({
      where: {
        user_id: userId,
        group_id,
      },
    });

    if (!quota) {
      quota = quotaRepository.create({
        user_id: userId,
        group_id,
        total_cost: group.default_cost_limit,
        used_cost: 0,
      });

      try {
        await quotaRepository.save(quota);
        console.log(`Created quota for user ${email} in group ${group_id} with default limit ${group.default_cost_limit}`);
      } catch (saveError) {
        console.error("Failed to save Quota:", saveError);
        throw new Error(
            `Failed to create quota: ${saveError instanceof Error ? saveError.message : "Unknown error"}`,
        );
      }
    }

    // Step 5: Auto-derive governance URL from request
    const host = request.headers.get("host") || "localhost:3000";
    // Detect protocol from X-Forwarded-Proto header (for proxies/load balancers) or default to http
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || "http";
    const governance_url =
        process.env.GOVERNANCE_URL || `${protocol}://${host}`;

    // Auto-derive OTEL endpoint for external clients
    // For localhost/127.0.0.1, use direct port access
    // For production domains, use same domain as governance URL
    let otel_endpoint = process.env.OTEL_ENDPOINT || "";
    if (!otel_endpoint && host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
      // Production domain detected - use same domain as governance URL
      otel_endpoint = governance_url;
    } else if (!otel_endpoint) {
      // Local development fallback
      otel_endpoint = "http://localhost:4318";
    }

    // Step 6: Create GRC key record
    const grcKey = grcKeyRepository.create({
      name,
      description: description || "",
      user_id: userId,
      group_id,
      governance_url,
      otel_endpoint,
    });

    // Ensure ID is generated before saving
    if (!grcKey.id) {
      const { v7: uuidv7 } = await import("uuid");
      grcKey.id = uuidv7();
    }

    await grcKeyRepository.save(grcKey);

    console.log(
        `Created GRC key "${name}" for ${email} in group ${group_id} (ID: ${grcKey.id})`,
    );

    // Step 7: Generate encoded key
    const keyData: ApiKeyData = {
      uid: userId,
      host: governance_url,
      otel: otel_endpoint,
      gid: group_id,
    };

    const encodedKey = encode(keyData);

    // Step 8: Return response
    return NextResponse.json(
        {
          success: true,
          key: {
            id: grcKey.id,
            name: grcKey.name,
            description: grcKey.description,
            encoded_key: encodedKey,
            user_id: userId,
            group_id: grcKey.group_id,
            created_at: grcKey.created_at,
          },
          invitation_created: invitationCreated,
          member_added: memberAdded,
          note: !user
              ? `User has not registered yet. API key will work immediately. The key will appear in the UI after the user registers with email: ${email}`
              : undefined,
        },
        { status: 201 },
    );
  } catch (error) {
    console.error("Failed to generate API key:", error);
    return NextResponse.json(
        {
          error: "Failed to generate API key",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
    );
  }
});
