/* io.h - in the browser TINY always talks to a "console". */
#ifndef TINY_SHIM_IO_H
#define TINY_SHIM_IO_H
#include <unistd.h>
#undef isatty
#define isatty(fd) 1
#endif
