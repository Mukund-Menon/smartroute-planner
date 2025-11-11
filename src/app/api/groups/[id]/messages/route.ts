import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { messages, groups, groupMembers, user } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Extract group ID from URL path
    const pathParts = request.nextUrl.pathname.split('/');
    const groupIdParam = pathParts[3];

    if (!groupIdParam || isNaN(parseInt(groupIdParam))) {
      return NextResponse.json(
        { error: 'Valid group ID is required', code: 'INVALID_GROUP_ID' },
        { status: 400 }
      );
    }

    const groupIdInt = parseInt(groupIdParam);

    // Check if group exists
    const group = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupIdInt))
      .limit(1);

    if (group.length === 0) {
      return NextResponse.json(
        { error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check if user is a member of the group
    const membership = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupIdInt),
          eq(groupMembers.userId, session.user.id)
        )
      )
      .limit(1);

    if (membership.length === 0) {
      return NextResponse.json(
        { error: 'Access denied: You are not a member of this group', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // Get all messages for the group with sender details
    const groupMessages = await db
      .select({
        id: messages.id,
        groupId: messages.groupId,
        userId: messages.userId,
        message: messages.message,
        createdAt: messages.createdAt,
        sender: {
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(messages)
      .leftJoin(user, eq(messages.userId, user.id))
      .where(eq(messages.groupId, groupIdInt))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json(groupMessages, { status: 200 });
  } catch (error) {
    console.error('GET messages error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Extract group ID from URL path
    const pathParts = request.nextUrl.pathname.split('/');
    const groupIdParam = pathParts[3];

    if (!groupIdParam || isNaN(parseInt(groupIdParam))) {
      return NextResponse.json(
        { error: 'Valid group ID is required', code: 'INVALID_GROUP_ID' },
        { status: 400 }
      );
    }

    const groupIdInt = parseInt(groupIdParam);

    const body = await request.json();

    // Security check: reject if userId provided in body
    if ('userId' in body || 'user_id' in body) {
      return NextResponse.json(
        {
          error: 'User ID cannot be provided in request body',
          code: 'USER_ID_NOT_ALLOWED',
        },
        { status: 400 }
      );
    }

    const { message } = body;

    // Validate message field
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json(
        { error: 'Message is required and cannot be empty', code: 'INVALID_MESSAGE' },
        { status: 400 }
      );
    }

    // Check if group exists
    const group = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupIdInt))
      .limit(1);

    if (group.length === 0) {
      return NextResponse.json(
        { error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check if user is a member of the group
    const membership = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupIdInt),
          eq(groupMembers.userId, session.user.id)
        )
      )
      .limit(1);

    if (membership.length === 0) {
      return NextResponse.json(
        { error: 'Access denied: You are not a member of this group', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // Insert new message
    const newMessage = await db
      .insert(messages)
      .values({
        groupId: groupIdInt,
        userId: session.user.id,
        message: message.trim(),
        createdAt: new Date().toISOString(),
      })
      .returning();

    // Get sender details
    const sender = await db
      .select({
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    const messageWithSender = {
      ...newMessage[0],
      sender: sender[0],
    };

    return NextResponse.json(messageWithSender, { status: 201 });
  } catch (error) {
    console.error('POST message error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}