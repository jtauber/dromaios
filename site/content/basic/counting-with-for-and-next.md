# Counting with FOR and NEXT

Give BASIC the starting number and the limit for a count. Use FOR and NEXT
to express the loop we already understand, then choose the gap between numbers.

## Keep the familiar counter

Load or resume BASIC using the instructions above, and begin at OK. If you
continued directly from [the previous lesson](a-program-that-counts.md), keep
its program and skip the setup block below. It should print 1 through 5.

If you are starting here or returning from a different lesson, type NEW and
enter this program. Type one numbered line at a time, pressing Enter and
waiting for its complete echo before the next:

```basic-session
> NEW

OK
> 10 LET N=1
> 20 PRINT N
> 30 LET N=N+1
> 40 IF N<=5 THEN 20
> 50 END
```

Line 10 sets the start. Line 30 changes the count, and line 40 tests whether
to go around again. BASIC has a pair of instructions for this pattern.

## Name the start and the limit

Replace lines 10 and 30, then remove line 40 by typing its number alone:

```basic-session
> 10 FOR N=1 TO 5
> 30 NEXT N
> 40
```

Keep line 20, which prints N, and line 50, which ends the program. LIST
should now show:

```basic-session
> LIST

10 FOR N=1 TO 5
20 PRINT N
30 NEXT N
50 END
OK
```

`FOR N=1 TO 5` sets N to 1 and remembers 5 as the limit for this loop.
Execution then reaches PRINT. At `NEXT N`, BASIC adds one to N and tests it
against the limit. If the new value is at most 5, execution returns to the
line just after FOR: our PRINT on line 20. Otherwise it continues to END.

Both instructions name N. That tells NEXT which loop it belongs to. The
instructions between FOR and NEXT are called the **body** of the loop;
here the body contains just PRINT.

RUN the changed program:

```basic-session
> RUN
 1
 2
 3
 4
 5

OK
> PRINT N
 6

OK
```

We get the same printed numbers and the same final value of N as before.
NEXT now does the adding and testing. Do not keep the old `LET N=N+1` in
the body: it would add another one on top of NEXT's change.

FOR supplies the starting value once. Returning from NEXT goes to the
body, so it does not set N back to 1 on every trip.

[Try the FOR loop ↑](#basic-terminal)

## Change the starting point

Replace only line 10. **Which numbers will be printed now?**

```basic-session
> 10 FOR N=3 TO 5
> RUN
 3
 4
 5

OK
```

The count begins at 3 and includes 5. Now make the starting value equal to
the limit:

```basic-session
> 10 FOR N=5 TO 5
> RUN
 5

OK
```

That is one trip through the body. After PRINT, NEXT changes N to 6, which
is beyond the limit. The 5 after TO is a limit on the value of N, not an
instruction to repeat five times.

## Choose the gap

So far, NEXT has added one each time. A STEP in the FOR instruction chooses
a different amount. **Predict the output when the step is 2:**

```basic-session
> 10 FOR N=1 TO 5 STEP 2
> RUN
 1
 3
 5

OK
> PRINT N
 7

OK
```

NEXT adds 2 after each PRINT: 1 becomes 3, 3 becomes 5, and 5 becomes 7.
The value 7 is beyond the limit, so it is not printed by the program.
Without a STEP, BASIC uses a step of 1.

**Does the count have to land exactly on the limit?** Change 5 to 6:

```basic-session
> 10 FOR N=1 TO 6 STEP 2
> RUN
 1
 3
 5

OK
```

The output is unchanged. Adding 2 to 5 gives 7, which is already beyond 6.
The loop stops without ever printing its limit.

[Choose a start, limit, and step ↑](#basic-terminal)

## Where is the test?

This version of BASIC reaches the body before NEXT makes its first test.
Even a starting value beyond the limit gets one trip through the body:

```basic-session
> 10 FOR N=5 TO 3
> RUN
 5

OK
```

FOR sets N to 5, PRINT displays it, and NEXT adds one. Only then does the
test end the loop. Remember this order when experimenting with other
starting values; an upward count whose start is beyond its limit does not
skip the body in this BASIC.

Finish by restoring the simple count from 1 through 5:

```basic-session
> 10 FOR N=1 TO 5
> RUN
 1
 2
 3
 4
 5

OK
```

We have kept the action, PRINT N, separate from the counting rule. Changing
the start, limit, or step leaves that action alone. The loop controls which
values it sees.

The original [Altair BASIC manual](https://altairclone.com/downloads/manuals/BASIC%20Manual%2075.pdf){:target="_blank" rel="noopener"}
describes FOR and NEXT on printed pages 32–33, including the test at NEXT
and the first trip through the body.
