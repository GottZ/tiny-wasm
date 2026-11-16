/* conio.h - Turbo C 2.0 text-screen API, reimplemented for the browser.
   The 80x25 screen lives in WASM memory (see shim.c); JavaScript paints it. */
#ifndef TINY_SHIM_CONIO_H
#define TINY_SHIM_CONIO_H

/* libc already owns the name gettext (libintl) */
#define gettext shim_gettext

struct text_info {
    unsigned char winleft, wintop, winright, winbottom;
    unsigned char attribute, normattr, currmode;
    unsigned char screenheight, screenwidth, curx, cury;
};

enum text_modes { LASTMODE = -1, BW40 = 0, C40, BW80, C80, MONO = 7 };

void window(int left, int top, int right, int bottom);
void gotoxy(int x, int y);
int  wherex(void);
int  wherey(void);
void textattr(int attr);
void textmode(int mode);
void clrscr(void);
int  putch(int c);
int  cputs(const char *s);
int  cprintf(const char *fmt, ...);
int  gettext(int left, int top, int right, int bottom, void *dest);
void gettextinfo(struct text_info *ti);
int  getch(void);
int  kbhit(void);

#endif
