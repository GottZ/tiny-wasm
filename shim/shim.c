/* shim.c - Turbo C 2.0 conio/dos runtime for the browser (Emscripten).

   TINY.C is compiled unchanged with -D__TURBOC__, so it takes its DOS
   full-screen path.  This file supplies what Turbo C and the PC supplied:

     screen   an 80x25 buffer of (character, attribute) cells plus the 16
              palette colours; JavaScript paints it on a canvas
     keyboard getch/kbhit read a queue filled by JavaScript
     timer    delay() advances a virtual clock and only yields to the
              browser when that clock is ahead of real time, so 1 ms PC
              speaker steps stay exact although browser timers are coarse
     speaker  sound()/nosound() become timestamped events for WebAudio

   Blocking calls (getch, delay) use Asyncify. */

#include <emscripten.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "conio.h"
#include "dos.h"

#define COLS 80
#define ROWS 25

static unsigned char screen[ROWS * COLS * 2];
static unsigned char palette[16 * 3];       /* 8-bit RGB per text colour */
static int state[4];                        /* changes, cursor x, y, visible */

static int win_l = 1, win_t = 1, win_r = COLS, win_b = ROWS;
static int cur_x = 1, cur_y = 1;            /* inside the window, from 1 */
static int attr = 7;
static unsigned cursor_shape = 0x0607;
static int idle_polls;

/* text colour -> VGA colour register, as the BIOS sets it up */
static const unsigned char color_reg[16] =
    { 0, 1, 2, 3, 4, 5, 20, 7, 56, 57, 58, 59, 60, 61, 62, 63 };
static const unsigned char vga_default[16 * 3] = {
    0x00,0x00,0x00, 0x00,0x00,0xAA, 0x00,0xAA,0x00, 0x00,0xAA,0xAA,
    0xAA,0x00,0x00, 0xAA,0x00,0xAA, 0xAA,0x55,0x00, 0xAA,0xAA,0xAA,
    0x55,0x55,0x55, 0x55,0x55,0xFF, 0x55,0xFF,0x55, 0x55,0xFF,0xFF,
    0xFF,0x55,0x55, 0xFF,0x55,0xFF, 0xFF,0xFF,0x55, 0xFF,0xFF,0xFF
};

EM_JS(void, js_sound, (int hz, double at), { Module.tiny.sound(hz, at); });
EM_JS(int, js_key_waiting, (void), { return Module.tiny.keyWaiting(); });
EM_JS(int, js_key_take, (void), { return Module.tiny.keyTake(); });
EM_JS(void, js_exited, (void), { Module.tiny.exited(); });

EMSCRIPTEN_KEEPALIVE unsigned char *shim_screen(void)  { return screen; }
EMSCRIPTEN_KEEPALIVE unsigned char *shim_palette(void) { return palette; }
EMSCRIPTEN_KEEPALIVE int *shim_state(void)             { return state; }

static void changed(void)
{
    state[0]++;
    state[1] = win_l + cur_x - 2;
    state[2] = win_t + cur_y - 2;
    state[3] = (cursor_shape & 0x2000) == 0;
    idle_polls = 0;
}

static unsigned char *cell(int x, int y)    /* screen position, from 1 */
{
    return screen + ((y - 1) * COLS + (x - 1)) * 2;
}

static void blank(int x1, int y1, int x2, int y2)
{
    int x, y;
    for (y = y1; y <= y2; y++)
        for (x = x1; x <= x2; x++) {
            cell(x, y)[0] = ' ';
            cell(x, y)[1] = (unsigned char)attr;
        }
}

static void line_feed(void)
{
    int y, width = (win_r - win_l + 1) * 2;
    if (cur_y < win_b - win_t + 1) {
        cur_y++;
        return;
    }
    for (y = win_t; y < win_b; y++)
        memmove(cell(win_l, y), cell(win_l, y + 1), width);
    blank(win_l, win_b, win_r, win_b);
}

/* ---- conio ---- */

void window(int left, int top, int right, int bottom)
{
    if (left < 1 || top < 1 || right > COLS || bottom > ROWS ||
        left > right || top > bottom)
        return;
    win_l = left; win_t = top; win_r = right; win_b = bottom;
    cur_x = cur_y = 1;
    changed();
}

void gotoxy(int x, int y)
{
    if (x < 1 || y < 1 || x > win_r - win_l + 1 || y > win_b - win_t + 1)
        return;
    cur_x = x; cur_y = y;
    changed();
}

int wherex(void) { return cur_x; }
int wherey(void) { return cur_y; }

void textattr(int a) { attr = a & 0xFF; }

void clrscr(void)
{
    blank(win_l, win_t, win_r, win_b);
    cur_x = cur_y = 1;
    changed();
}

void textmode(int mode)
{
    (void)mode;
    memcpy(palette, vga_default, sizeof(palette));
    win_l = win_t = 1; win_r = COLS; win_b = ROWS;
    attr = 7;
    cursor_shape = 0x0607;
    clrscr();
}

int putch(int c)
{
    unsigned char *p;
    switch (c & 0xFF) {
    case '\a': break;
    case '\b': if (cur_x > 1) cur_x--; break;
    case '\r': cur_x = 1; break;
    case '\n': line_feed(); break;
    default:
        p = cell(win_l + cur_x - 1, win_t + cur_y - 1);
        p[0] = (unsigned char)c;
        p[1] = (unsigned char)attr;
        if (++cur_x > win_r - win_l + 1) {
            cur_x = 1;
            line_feed();
        }
    }
    changed();
    return c;
}

int cputs(const char *s)
{
    int c = 0;
    while (*s)
        c = putch((unsigned char)*s++);
    return c;
}

int cprintf(const char *fmt, ...)
{
    char buf[256];
    int n;
    va_list ap;
    va_start(ap, fmt);
    n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    cputs(buf);
    return n;
}

int gettext(int left, int top, int right, int bottom, void *dest)
{
    unsigned char *d = (unsigned char *)dest;
    int y, width;
    if (left < 1 || top < 1 || right > COLS || bottom > ROWS ||
        left > right || top > bottom)
        return 0;
    width = (right - left + 1) * 2;
    for (y = top; y <= bottom; y++, d += width)
        memcpy(d, cell(left, y), width);
    return 1;
}

void gettextinfo(struct text_info *ti)
{
    ti->winleft = (unsigned char)win_l;   ti->wintop = (unsigned char)win_t;
    ti->winright = (unsigned char)win_r;  ti->winbottom = (unsigned char)win_b;
    ti->attribute = (unsigned char)attr;  ti->normattr = 7;
    ti->currmode = C80;
    ti->screenheight = ROWS;              ti->screenwidth = COLS;
    ti->curx = (unsigned char)cur_x;      ti->cury = (unsigned char)cur_y;
}

/* ---- timer and speaker ---- */

static double clock_ms;         /* where the program is, in browser time */

static double program_time(void)
{
    double now = emscripten_get_now();
    if (clock_ms < now - 40.0)  /* fell behind (computing, waiting): catch up */
        clock_ms = now;
    return now;
}

void delay(unsigned ms)
{
    double now = program_time();
    clock_ms += ms;
    idle_polls = 0;
    if (clock_ms - now >= 4.0)
        emscripten_sleep((unsigned)(clock_ms - now));
}

void sound(unsigned hz)
{
    program_time();
    js_sound((int)hz, clock_ms);
}

void nosound(void)
{
    program_time();
    js_sound(0, clock_ms);
}

/* ---- keyboard ---- */

int kbhit(void)
{
    /* a program spinning on kbhit() must still let the browser breathe */
    if (++idle_polls > 1)
        emscripten_sleep(8);
    return js_key_waiting();
}

int getch(void)
{
    while (!js_key_waiting())
        emscripten_sleep(8);
    idle_polls = 0;
    return js_key_take();
}

/* ---- BIOS and DOS services ---- */

int int86(int intno, union REGS *in, union REGS *out)
{
    union REGS r = *in;
    int i;
    if (intno == 0x10) {
        switch (r.h.ah) {
        case 0x01:                              /* set cursor shape */
            cursor_shape = r.x.cx;
            changed();
            break;
        case 0x03:                              /* get cursor */
            r.x.cx = (unsigned short)cursor_shape;
            r.h.dh = (unsigned char)(win_t + cur_y - 2);
            r.h.dl = (unsigned char)(win_l + cur_x - 2);
            break;
        case 0x1A:                              /* display type: VGA colour */
            if (r.h.al == 0x00) { r.h.al = 0x1A; r.h.bl = 0x08; r.h.bh = 0; }
            break;
        case 0x10:
            if (r.h.al == 0x10) {               /* set one colour register */
                for (i = 0; i < 16; i++)
                    if (color_reg[i] == r.x.bx) {
                        palette[i * 3]     = (unsigned char)((r.h.dh & 63) * 255 / 63);
                        palette[i * 3 + 1] = (unsigned char)((r.h.ch & 63) * 255 / 63);
                        palette[i * 3 + 2] = (unsigned char)((r.h.cl & 63) * 255 / 63);
                    }
                changed();
            }                                   /* AL=03 blink off: always off here */
            break;
        }
    }
    *out = r;
    return r.x.ax;
}

void gettime(struct time *t)
{
    time_t now = time(NULL);
    struct tm *tm = localtime(&now);
    t->ti_hour = (unsigned char)tm->tm_hour;
    t->ti_min = (unsigned char)tm->tm_min;
    t->ti_sec = (unsigned char)tm->tm_sec;
    t->ti_hund = 0;
}

/* ---- start and end ---- */

int tiny_main(int argc, char **argv);       /* main() of TINY.C */

static void finished(void)
{
    static int once;
    if (once++)
        return;
    js_sound(0, emscripten_get_now());
    fflush(stdout);
    js_exited();
}

int main(int argc, char **argv)
{
    int rc;
    memcpy(palette, vga_default, sizeof(palette));
    blank(1, 1, COLS, ROWS);
    changed();
    atexit(finished);
    rc = tiny_main(argc, argv);
    finished();
    return rc;
}
