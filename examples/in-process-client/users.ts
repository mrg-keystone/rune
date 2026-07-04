import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@danet/core";

/**
 * A tiny in-memory Users API. Nothing here is special to the in-process client —
 * it's an ordinary Danet controller. The point of the example is that the SAME
 * pipeline (controllers, guards, pipes, filters, middleware) is what `backend.fetch`
 * dispatches against, with no port and no token.
 */

interface User {
  id: number;
  name: string;
}

const users: User[] = [{ id: 1, name: "Alice" }];
let nextId = 2;

@Controller("users")
class UsersController {
  /** GET /users — list everyone. */
  @Get()
  list(): User[] {
    return users;
  }

  /** GET /users/:id — one user, or a real 404 through the framework if missing. */
  @Get(":id")
  get(@Param("id") id: string): User {
    const user = users.find((u) => u.id === Number(id));
    if (!user) {
      // The framework turns this into the same 404 a network client would see —
      // the exception filter runs in-process too.
      throw new NotFoundException();
    }
    return user;
  }

  /** POST /users — create one from the JSON body. */
  @Post()
  create(@Body() body: { name: string }): User {
    const user: User = { id: nextId++, name: body.name };
    users.push(user);
    return user;
  }
}

@Module({ controllers: [UsersController] })
export class AppModule {}
