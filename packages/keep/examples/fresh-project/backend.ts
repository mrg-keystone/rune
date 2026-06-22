import { bootstrapServer, Public } from "@mrg-keystone/keep";
import { Controller, Get, Module, NotFoundException, Param } from "@danet/core";

interface User {
  id: number;
  name: string;
}

const users: User[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

@Controller("users")
class UsersController {
  @Get()
  list(): User[] {
    return users;
  }

  @Get(":id")
  get(@Param("id") id: string): User {
    const user = users.find((u) => u.id === Number(id));
    if (!user) throw new NotFoundException();
    return user;
  }
}

@Controller("health")
class HealthController {
  @Public()
  @Get()
  check() {
    return { status: "ok", public: true };
  }
}

@Module({ controllers: [UsersController, HealthController] })
class AppModule {}

export const api = await bootstrapServer("fresh-project", AppModule, {
  swagger: true,
});
