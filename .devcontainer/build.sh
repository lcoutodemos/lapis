#!/bin/bash
# This is a script used by the devcontainer to build the project.
#
# The upstream AFFiNE backend (packages/backend/**) has been removed from this
# fork; the server-native build step and Prisma migration reset that used to
# live here are no longer applicable. If you add a new local backend, wire its
# bootstrap steps below.

# install dependencies
yarn install
