/* dos.h - the few Turbo C 2.0 DOS services TINY uses. */
#ifndef TINY_SHIM_DOS_H
#define TINY_SHIM_DOS_H

struct WORDREGS { unsigned short ax, bx, cx, dx, si, di, cflag, flags; };
struct BYTEREGS { unsigned char al, ah, bl, bh, cl, ch, dl, dh; };
union REGS { struct WORDREGS x; struct BYTEREGS h; };

struct time { unsigned char ti_min, ti_hour, ti_hund, ti_sec; };

int  int86(int intno, union REGS *in, union REGS *out);
void gettime(struct time *t);
void delay(unsigned ms);
void sound(unsigned hz);
void nosound(void);

#endif
